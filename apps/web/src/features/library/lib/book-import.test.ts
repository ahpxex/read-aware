import { withDomainBackup } from "../../../platform/domain-write-gate";
import { afterEach, expect, spyOn, test } from "bun:test";
import type { TFunction } from "i18next";
import * as environment from "../../../platform/environment";
import * as ipc from "../../../platform/ipc";
import * as blobs from "../../../platform/blob-store";
import * as events from "../../../platform/domain-events";
import * as library from "./library-db";
import { importBook, pendingImportPlaceholder } from "./book-import";
import type { BookImportSource } from "./library-types";
import { ResourceOwner, type ResourceAdapter } from "../../../services/resource-owner";
import { importResourceBook } from "../../../domain/library-resource-import";

const source: BookImportSource = {
  kind: "native-resource",
  resourceId: "private-native-id",
  name: "book.txt",
  size: 7,
  type: "text/plain",
};
const t = ((key: string) => key) as TFunction<"shelf">;
const hlc = { wallMs: 1_700_000_000_000, counter: 0, deviceId: "device-a" };
/** What `library_import` answers for a committed import. */
const imported = {
  status: "imported",
  cover: "none",
  metadataDeferred: false,
  events: [
    {
      type: "book.imported",
      hlc,
      payload: { bookId: "new", title: "New book", fileSize: 7, sourceSha256: "content-hash" },
    },
    { type: "book.coverExtracted", hlc: { ...hlc, counter: 1 }, payload: { bookId: "new", status: "none" } },
  ],
};
const restore: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of restore.splice(0).reverse()) cleanup();
});

function setup() {
  const native = spyOn(environment, "isTauri").mockReturnValue(true);
  const invoke = spyOn(ipc, "invoke").mockImplementation(
    async <T>(command: string) => (command === "library_import" ? imported : undefined) as T,
  );
  const put = spyOn(blobs, "putDesktopBlob").mockResolvedValue({ sha256: "content-hash", byteSize: 7 });
  const broadcast = spyOn(events, "broadcastDomainEventDrafts").mockImplementation(() => {});
  const observe = spyOn(events, "observeCommittedStamps").mockImplementation(() => {});
  const book = pendingImportPlaceholder("existing", source, "txt");
  const get = spyOn(library, "getBookRecord").mockResolvedValue(book);
  for (const mock of [native, invoke, put, broadcast, observe, get]) restore.push(() => mock.mockRestore());
  return { invoke, put, broadcast, observe, get, book };
}
/** The request of the last `library_import` call. */
function lastImport(invoke: ReturnType<typeof setup>["invoke"]) {
  const call = invoke.mock.calls.filter(([command]) => command === "library_import").at(-1);
  return (call?.[1] as { request: Record<string, unknown> } | undefined)?.request;
}

test("an import records recovery ownership before bytes and releases it after a failed import", async () => {
  const f = setup(),
    order: string[] = [],
    failure = new Error("import failed");
  f.invoke.mockImplementation(async <T>(command: string) => {
    order.push(command);
    if (command === "library_import") throw failure;
    return undefined as T;
  });
  f.put.mockImplementation(async () => {
    order.push("bytes");
    return { sha256: "content-hash", byteSize: 7 };
  });
  await expect(
    importBook({ kind: "file", file: new File(["content"], "book.txt") }, { t, knownBooks: [] }),
  ).rejects.toBe(failure);
  expect(order).toEqual(["library_begin_import", "bytes", "library_import", "library_finish_import"]);
  expect(f.broadcast).not.toHaveBeenCalled();
});

test("cleanup failure cannot hide the original import failure and leaves the native intent for recovery", async () => {
  const f = setup(),
    failure = new Error("import failed");
  f.invoke.mockImplementation(async <T>(command: string) => {
    if (command === "library_finish_import") throw new Error("file release failed");
    if (command === "library_import") throw failure;
    return undefined as T;
  });
  await expect(
    importBook({ kind: "file", file: new File(["content"], "book.txt") }, { t, knownBooks: [] }),
  ).rejects.toBe(failure);
});

test("resource imports run natively and use content deduplication even with matching name and size", async () => {
  const { invoke, put, broadcast, observe, book } = setup();
  const result = await importBook(source, { t, knownBooks: [book], origin: "plugin:fixture" });
  expect(result.status).toBe("imported");
  expect(lastImport(invoke)).toEqual({
    bookId: expect.any(String),
    fileName: "book.txt",
    mimeType: "text/plain",
    sourcePath: null,
    origin: "plugin:fixture",
    dedupeByName: false,
    source: { kind: "resource", id: "private-native-id" },
  });
  expect(put).not.toHaveBeenCalled();
  expect(observe).toHaveBeenCalledWith([hlc, { ...hlc, counter: 1 }]);
  expect(broadcast.mock.calls[0]?.[0]?.[0]).toMatchObject({
    type: "book.imported",
    origin: "plugin:fixture",
    payload: { sourceSha256: "content-hash", fileSize: 7, title: "New book" },
  });
});

test("native resource duplicate receipt points to the existing book without another import event", async () => {
  const { invoke, put, broadcast, book } = setup();
  invoke.mockImplementation(
    async <T>(command: string) =>
      (command === "library_import" ? { status: "duplicate", book: { id: book.id } } : undefined) as T,
  );
  expect(await importBook(source, { t, knownBooks: [book] })).toEqual({ status: "duplicate", book });
  expect(broadcast).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});

test("external paths carry native admission epochs while manual paths do not", async () => {
  const { invoke } = setup();
  const path: BookImportSource = { kind: "native-path", path: "/books/book.txt", name: "book.txt", size: 7 };
  await importBook({ ...path, externalOpenEpoch: "accepted-batch" }, { t, knownBooks: [] });
  expect(lastImport(invoke)).toEqual({
    bookId: expect.any(String),
    fileName: "book.txt",
    mimeType: null,
    sourcePath: null,
    origin: null,
    dedupeByName: true,
    externalOpenEpoch: "accepted-batch",
    source: { kind: "path", path: path.path },
  });
  await importBook(path, { t, knownBooks: [] });
  expect(lastImport(invoke)).not.toHaveProperty("externalOpenEpoch");
});

test("revoked native admission cannot announce an import event", async () => {
  const { invoke, broadcast } = setup();
  const error = { code: "ui/unavailable", message: "External request revoked" };
  invoke.mockRejectedValue(error);
  await expect(
    importBook(
      { kind: "native-path", path: "/books/book.txt", name: "book.txt", size: 7, externalOpenEpoch: "revoked-batch" },
      { t, knownBooks: [] },
    ),
  ).rejects.toBe(error);
  expect(broadcast).not.toHaveBeenCalled();
});

test("cancellation prevents the native import but does not abandon an already accepted one", async () => {
  const { invoke, broadcast } = setup();
  await expect(importBook(source, { t, knownBooks: [], signal: AbortSignal.abort() })).rejects.toBeDefined();
  expect(invoke).not.toHaveBeenCalled();
  const controller = new AbortController();
  invoke.mockImplementation(async () => {
    controller.abort();
    return imported as never;
  });
  expect((await importBook(source, { t, knownBooks: [], signal: controller.signal })).status).toBe("imported");
  expect(broadcast).toHaveBeenCalledTimes(1);
});

test("a cancelled file read writes no blob; cancellation during the accepted blob write still finalizes", async () => {
  const { invoke, put, broadcast } = setup();
  const file = new File(["content"], "book.txt"),
    controller = new AbortController();
  const bytes = spyOn(file, "arrayBuffer").mockImplementation(async () => {
    controller.abort();
    return new ArrayBuffer(7);
  });
  try {
    await expect(
      importBook({ kind: "file", file }, { t, knownBooks: [], signal: controller.signal }),
    ).rejects.toBeDefined();
    expect(put).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  } finally {
    bytes.mockRestore();
  }
  const accepted = new AbortController();
  put.mockImplementation(async () => {
    accepted.abort();
    return { sha256: "content-hash", byteSize: 7 };
  });
  expect((await importBook({ kind: "file", file }, { t, knownBooks: [], signal: accepted.signal })).status).toBe(
    "imported",
  );
  expect(broadcast).toHaveBeenCalledTimes(1);
});

test("prepared UI cancellation and resource admission failure prevent the first durable write", async () => {
  const { invoke, put, broadcast } = setup(),
    controller = new AbortController();
  await expect(
    importBook(source, { t, knownBooks: [], signal: controller.signal, onPrepared: () => controller.abort() }),
  ).rejects.toBeDefined();
  const failure = new Error("Resource lease retired");
  await expect(
    importBook(source, {
      t,
      knownBooks: [],
      beforeWrite: () => {
        throw failure;
      },
    }),
  ).rejects.toBe(failure);
  expect(put).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
  expect(broadcast).not.toHaveBeenCalled();
});

test.each(["imported", "duplicate"])(
  "resource domain preserves %s through cancellation and resource-owner retirement",
  async (status) => {
    const { invoke, book } = setup(),
      controller = new AbortController();
    const list = spyOn(library, "listLibraryBooks").mockResolvedValue([book]);
    restore.push(() => list.mockRestore());
    let released = false,
      retiring: Promise<void> | undefined;
    const unexpected = async () => {
      throw new Error("Unexpected resource operation during import");
    };
    const adapter: ResourceAdapter = {
      create: async () => ({ id: "native-import", name: "book.txt", size: 7, mimeType: "text/plain" }),
      commit: async () => {},
      release: async () => {
        released = true;
      },
      pick: unexpected,
      openBook: unexpected,
      openCover: unexpected,
      read: unexpected,
      append: unexpected,
      commitContext: unexpected,
      save: unexpected,
      copyImage: unexpected,
      imagePreview: unexpected,
    };
    const owner = new ResourceOwner(adapter, () => {});
    try {
      const ref = await owner.create({ name: "book.txt" });
      await owner.commit(ref.id);
      invoke.mockImplementation(async () => {
        controller.abort();
        retiring = owner.dispose();
        expect(released).toBe(false);
        return (status === "duplicate" ? { status, book: { id: book.id } } : imported) as never;
      });
      expect(await importResourceBook(owner, ref.id, "agent", controller.signal)).toMatchObject({
        status,
        book: { id: book.id },
      });
      await retiring;
      expect(released).toBe(true);
    } finally {
      await owner.dispose();
    }
  },
);

test("backup drains an accepted import through its book event and rejects a fresh native import", async () => {
  const f = setup(),
    entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  f.invoke.mockImplementation(async <T>() => {
    entered.resolve();
    await release.promise;
    return imported as T;
  });
  const work = importBook(source, { t, knownBooks: [] });
  await entered.promise;
  let captured = false;
  const backup = withDomainBackup(async () => {
    captured = true;
    expect(f.broadcast).toHaveBeenCalled();
    const before = f.invoke.mock.calls.length;
    await expect(importBook(source, { t, knownBooks: [] })).rejects.toMatchObject({ code: "backup/busy" });
    expect(f.invoke).toHaveBeenCalledTimes(before);
  });
  await Bun.sleep(0);
  expect(captured).toBe(false);
  release.resolve();
  expect((await work).status).toBe("imported");
  await backup;
});

test("folder imports record where the file was found; single files record nothing", async () => {
  const { invoke } = setup();
  const path: BookImportSource = { kind: "native-path", path: "/books/Sci-fi/book.txt", name: "book.txt", size: 7 };
  await importBook({ ...path, sourcePath: "books/Sci-fi/book.txt" }, { t, knownBooks: [] });
  expect(lastImport(invoke)).toMatchObject({ fileName: "book.txt", sourcePath: "books/Sci-fi/book.txt" });
  await importBook(path, { t, knownBooks: [] });
  expect(lastImport(invoke)?.sourcePath).toBeNull();
});
