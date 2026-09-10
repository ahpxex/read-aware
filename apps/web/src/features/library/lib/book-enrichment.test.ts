import { afterEach, expect, spyOn, test } from "bun:test";
import { AppError } from "@read-aware/core";
import * as library from "./library-db";
import * as events from "../../../platform/domain-events";
import { pendingImportPlaceholder } from "./book-import";
import { enrichFromOpenBook, enrichmentQueue, metadataNeedsEnrichment } from "./book-enrichment";
import type { FoliateBook } from "../../reader/lib/foliate-engine";

const restore: Array<() => void> = [];
afterEach(() => { for (const cleanup of restore.splice(0).reverse()) cleanup(); });
function fixture() {
  const book = pendingImportPlaceholder(crypto.randomUUID(), { kind: "native-path", path: "/private/book.pdf", name: "book.pdf", size: 10 }, "pdf");
  const get = spyOn(library, "getBookRecord").mockResolvedValue(book);
  const commit = spyOn(events, "commitDomainEvents").mockResolvedValue({ appended: 1, applied: 1 });
  restore.push(() => get.mockRestore(), () => commit.mockRestore());
  return { book, get, commit };
}

test("cover extraction failure stays retryable instead of committing a false no-cover verdict", async () => {
  const f = fixture(); f.book.title = "Custom title";
  const parsed = { metadata: {}, sections: [], getCover: async () => { throw new AppError("fs/not-found", "missing image"); } } as unknown as FoliateBook;
  await enrichFromOpenBook(f.book, parsed);
  expect(enrichmentQueue.snapshot(f.book.id)).toMatchObject({ phase: "failed", errorCode: "fs/not-found" });
  expect(f.commit).not.toHaveBeenCalled();
  parsed.getCover = async () => null;
  await enrichFromOpenBook(f.book, parsed);
  expect(enrichmentQueue.snapshot(f.book.id).phase).toBe("completed");
  expect(f.commit.mock.calls[0]?.[0]).toMatchObject({ type: "book.coverExtracted", payload: { status: "none" } });
});

test("parsed metadata keeps observed custom fields and retry eligibility covers non-PDF formats", async () => {
  const f = fixture(); f.book.coverStatus = "none";
  const latest = { ...f.book, title: "My title", author: "My author" };
  f.get.mockResolvedValue(latest);
  const parsed = { metadata: { title: "Parsed title", author: "Parsed author" }, sections: [] } as unknown as FoliateBook;
  await enrichFromOpenBook(f.book, parsed);
  expect(f.commit).not.toHaveBeenCalled();
  expect(enrichmentQueue.snapshot(f.book.id)).toMatchObject({ phase: "skipped", reason: "not-needed" });
  expect(metadataNeedsEnrichment({ ...f.book, format: "epub" })).toBe(true);
  expect(metadataNeedsEnrichment({ ...latest, format: "epub" })).toBe(false);
});
