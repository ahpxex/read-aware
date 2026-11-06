import { withDomainBackup } from "../../../platform/domain-write-gate";
import * as ipc from "../../../platform/ipc";
import { afterEach, expect, spyOn, test } from "bun:test";
import { AppError } from "@read-aware/core";
import * as library from "./library-db";
import * as events from "../../../platform/domain-events";
import { pendingImportPlaceholder } from "./book-import";
import * as environment from "../../../platform/environment";
import { onAppEvent } from "../../../platform/app-events";
import * as parsing from "../../reader/lib/parse-book";
import {
  enrichFromOpenBook,
  enrichmentQueue,
  metadataNeedsEnrichment,
  metadataPending,
  scheduleCatchUpEnrichment,
} from "./book-enrichment";
import type { FoliateBook } from "../../reader/lib/foliate-engine";

const restore: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of restore.splice(0).reverse()) cleanup();
});
function fixture() {
  const book = pendingImportPlaceholder(
    crypto.randomUUID(),
    { kind: "native-path", path: "/private/book.pdf", name: "book.pdf", size: 10 },
    "pdf",
  );
  const get = spyOn(library, "getBookRecord").mockResolvedValue(book);
  const commit = spyOn(events, "commitDomainEvents").mockResolvedValue({ appended: 1, applied: 1 });
  restore.push(
    () => get.mockRestore(),
    () => commit.mockRestore(),
  );
  return { book, get, commit };
}

test("cover extraction failure stays retryable instead of committing a false no-cover verdict", async () => {
  const f = fixture();
  f.book.title = "Custom title";
  const parsed = {
    metadata: {},
    sections: [],
    getCover: async () => {
      throw new AppError("fs/not-found", "missing image");
    },
  } as unknown as FoliateBook;
  await enrichFromOpenBook(f.book, parsed);
  expect(enrichmentQueue.snapshot(f.book.id)).toMatchObject({ phase: "failed", errorCode: "fs/not-found" });
  expect(f.commit).not.toHaveBeenCalled();
  parsed.getCover = async () => null;
  await enrichFromOpenBook(f.book, parsed);
  expect(enrichmentQueue.snapshot(f.book.id).phase).toBe("completed");
  expect(f.commit.mock.calls[0]?.[0]).toMatchObject({ type: "book.coverExtracted", payload: { status: "none" } });
});

test("parsed metadata keeps observed custom fields and retry eligibility covers non-PDF formats", async () => {
  const f = fixture();
  f.book.coverStatus = "none";
  const latest = { ...f.book, title: "My title", author: "My author" };
  f.get.mockResolvedValue(latest);
  const parsed = {
    metadata: { title: "Parsed title", author: "Parsed author" },
    sections: [],
  } as unknown as FoliateBook;
  await enrichFromOpenBook(f.book, parsed);
  expect(f.commit).not.toHaveBeenCalled();
  expect(enrichmentQueue.snapshot(f.book.id)).toMatchObject({ phase: "skipped", reason: "not-needed" });
  expect(metadataNeedsEnrichment({ ...f.book, format: "epub" })).toBe(true);
  expect(metadataNeedsEnrichment({ ...latest, format: "epub" })).toBe(false);
});

test("cover preparation may await backup, but file persistence and its verdict drain together", async () => {
  const f = fixture(),
    entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let prepared = false;
  const parsed = {
    metadata: {},
    sections: [],
    getCover: async () => {
      await withDomainBackup(async () => {
        prepared = true;
      });
      return new Blob(["cover"], { type: "image/png" });
    },
  } as unknown as FoliateBook;
  const invoke = spyOn(ipc, "invoke").mockImplementation(async <T>() => {
    entered.resolve();
    await release.promise;
    return { coverBlobKey: `cover:${f.book.id}` } as T;
  });
  restore.push(() => invoke.mockRestore());
  const work = enrichFromOpenBook(f.book, parsed);
  await entered.promise;
  expect(prepared).toBe(true);
  let captured = false;
  const backup = withDomainBackup(async () => {
    captured = true;
    expect(f.commit).toHaveBeenCalled();
  });
  await Bun.sleep(0);
  expect(captured).toBe(false);
  release.resolve();
  await work;
  await backup;
  expect(f.commit.mock.calls[0]?.[0]).toMatchObject({ type: "book.coverExtracted", payload: { status: "ready" } });
});

test("a book removed during cover preparation is rechecked before writing any cover or verdict", async () => {
  const f = fixture();
  const parsed = {
    metadata: {},
    sections: [],
    getCover: async () => {
      f.get.mockResolvedValue(null);
      return new Blob(["cover"]);
    },
  } as unknown as FoliateBook;
  const invoke = spyOn(ipc, "invoke").mockImplementation(async () => {
    throw Error("must not write a removed book");
  });
  restore.push(() => invoke.mockRestore());
  await enrichFromOpenBook(f.book, parsed);
  expect(invoke).not.toHaveBeenCalled();
  expect(f.commit).not.toHaveBeenCalled();
  expect(enrichmentQueue.snapshot(f.book.id)).toMatchObject({ phase: "skipped", reason: "book-removed" });
});

/** A cover on record whose bytes never reached this device, on a book whose file is here. */
function missingCover(format: "epub" | "cbr" = "epub") {
  const f = fixture();
  Object.assign(f.book, { format, coverStatus: "ready", coverBlobKey: `cover:${f.book.id}`, coverLocal: false });
  const tauri = spyOn(environment, "isTauri").mockReturnValue(true);
  const changed: string[] = [];
  const stop = onAppEvent("book-changed", ({ bookId }) => changed.push(bookId));
  restore.push(
    () => tauri.mockRestore(),
    () => stop(),
  );
  return { ...f, changed };
}

async function settled(until: () => boolean) {
  for (let turn = 0; turn < 200 && !until(); turn++) await new Promise((resolve) => setTimeout(resolve, 0));
  expect(until()).toBe(true);
}

test("a cover on record but missing here is restored from the local file once, with no new verdict", async () => {
  const f = missingCover();
  const invoke = spyOn(ipc, "invoke").mockImplementation(async <T>(command: string) => {
    expect(command).toBe("library_restore_local_cover");
    return "restored" as T;
  });
  restore.push(() => invoke.mockRestore());
  scheduleCatchUpEnrichment([f.book]);
  await settled(() => f.changed.includes(f.book.id));
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0]?.[1]).toEqual({ bookId: f.book.id });
  // A shelf reload before the repaint lands does not ask again.
  scheduleCatchUpEnrichment([f.book]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(f.commit).not.toHaveBeenCalled();
});

test("a missing cover only the engine can read is extracted by the engine job and stored without a verdict", async () => {
  const f = missingCover("cbr");
  const file = spyOn(library, "openLocalBookFile").mockResolvedValue(new File(["comic"], "book.cbr"));
  const destroyed = { value: false };
  const parse = spyOn(parsing, "parseBookFile").mockResolvedValue({
    metadata: {},
    sections: [],
    getCover: async () => new Blob(["cover"], { type: "image/png" }),
    destroy: async () => {
      destroyed.value = true;
    },
  } as unknown as FoliateBook);
  const invoke = spyOn(ipc, "invoke").mockImplementation(async <T>(command: string) => {
    if (command === "library_restore_local_cover") return "engine" as T;
    expect(command).toBe("library_put_cover");
    return { coverBlobKey: `cover:${f.book.id}`, sha256: "hash" } as T;
  });
  restore.push(
    () => file.mockRestore(),
    () => parse.mockRestore(),
    () => invoke.mockRestore(),
  );
  scheduleCatchUpEnrichment([f.book]);
  await settled(() => enrichmentQueue.snapshot(f.book.id).phase === "completed");
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(["library_restore_local_cover", "library_put_cover"]);
  expect(f.changed).toContain(f.book.id);
  expect(f.commit).not.toHaveBeenCalled();
  expect(destroyed.value).toBe(true);
});

test("a deferred import settles once the engine pass ran, without touching custom fields", async () => {
  const f = fixture();
  f.book.coverStatus = "none";
  const latest = { ...f.book, title: "My title", author: "My author", metadataStatus: "deferred" as const };
  f.get.mockResolvedValue(latest);
  const parsed = { metadata: { title: "Parsed title" }, sections: [] } as unknown as FoliateBook;
  await enrichFromOpenBook(latest, parsed);
  expect(f.commit).toHaveBeenCalledTimes(1);
  // Settled, and the user's title is left alone (no metadataEdited).
  expect(f.commit.mock.calls[0]).toHaveLength(1);
  expect(f.commit.mock.calls[0]?.[0]).toMatchObject({
    type: "book.metadataSettled",
    payload: { bookId: f.book.id },
  });
});

test("metadata waits on the engine by recorded status, and by the file-name heuristic only for older books", () => {
  const { book } = fixture();
  // The placeholder's title is the file-name guess.
  expect(metadataPending({ ...book, metadataStatus: "settled" })).toBe(false);
  expect(metadataPending({ ...book, metadataStatus: "deferred", title: "Real title" })).toBe(true);
  expect(metadataPending({ ...book, metadataStatus: null })).toBe(true);
  expect(metadataPending({ ...book, metadataStatus: null, title: "Real title" })).toBe(false);
});
