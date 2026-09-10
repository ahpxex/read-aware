import { afterEach, expect, spyOn, test } from "bun:test";
import { AppError, type BookEnrichmentObservation } from "@read-aware/core";
import * as environment from "../platform/environment";
import * as library from "../features/library/lib/library-db";
import { pendingImportPlaceholder } from "../features/library/lib/book-import";
import { enrichmentQueue } from "../features/library/lib/book-enrichment";
import { createActorDomainView } from "./registry";
import { getBookEnrichment, retryBookEnrichment, createEnrichmentObserver } from "./book-enrichment";

const restore: Array<() => void> = [];
afterEach(() => { for (const cleanup of restore.splice(0).reverse()) cleanup(); });
function fixture() {
  const book = pendingImportPlaceholder("enrichment-fixture", { kind: "native-path", path: "/private/book.pdf", name: "book.pdf", size: 10 }, "pdf");
  const native = spyOn(environment, "isTauri").mockReturnValue(true);
  const get = spyOn(library, "getBookRecord").mockResolvedValue(book);
  const local = spyOn(library, "hasLocalBookFile").mockResolvedValue(true);
  const schedule = spyOn(enrichmentQueue, "enqueue").mockImplementation(request => ({ request,
    job: { phase: "queued", startedAt: null, finishedAt: null, errorCode: null, reason: null },
    done: Promise.resolve({ phase: "completed", startedAt: 1, finishedAt: 2, errorCode: null, reason: null }) }));
  for (const mock of [native, get, local, schedule]) restore.push(() => mock.mockRestore());
  return { book, get, local, schedule };
}

test("enrichment reads project availability without parsing, and only write grants expose retry", async () => {
  const f = fixture();
  const read = createActorDomainView("plugin:read", { library: "read" });
  expect(read.library!.commands).toBeUndefined();
  expect(await read.library!.queries.books.getEnrichment(f.book.id)).toMatchObject({ sourceLocal: true, metadataPending: true, cover: { status: "unchecked", local: false } });
  expect(f.schedule).not.toHaveBeenCalled();
  const write = createActorDomainView("plugin:write", { library: "write" });
  expect(await write.library!.commands!.books.retryEnrichment(f.book.id)).toMatchObject({ status: "queued", snapshot: { job: { phase: "queued" } } });
  expect(f.schedule).toHaveBeenCalledWith({ bookId: f.book.id, cover: true, metadata: true, origin: "plugin:write" });
  await expect(retryBookEnrichment(f.book.id, "agent", AbortSignal.abort())).rejects.toBeDefined();
  expect(f.schedule).toHaveBeenCalledTimes(1);
});

test("missing source, settled metadata, deleted books and load failures have distinct results", async () => {
  const f = fixture(); f.local.mockResolvedValue(false);
  expect((await retryBookEnrichment(f.book.id, "agent")).status).toBe("unavailable");
  f.local.mockResolvedValue(true); f.book.coverStatus = "none"; f.book.title = "Custom title"; f.book.author = "Custom author";
  expect((await retryBookEnrichment(f.book.id, "agent")).status).toBe("not-needed");
  expect(f.schedule).not.toHaveBeenCalled();
  f.get.mockResolvedValue(null);
  await expect(getBookEnrichment(f.book.id)).rejects.toMatchObject({ code: "reader/book-not-found" });
  f.get.mockRejectedValue(new AppError("db/locked", "private error"));
  await expect(getBookEnrichment(f.book.id)).rejects.toMatchObject({ code: "db/locked" });
});

test("observers report load errors, recover, serialize callbacks and retire without another poll", async () => {
  const f = fixture(), events: BookEnrichmentObservation[] = [], lifetime = new AbortController();
  f.get.mockRejectedValue(new AppError("db/locked", "private error"));
  const observe = createEnrichmentObserver(lifetime.signal);
  const stop = observe(f.book.id, event => { events.push(event); });
  await Bun.sleep(0); expect(events[0]).toEqual({ status: "error", errorCode: "db/locked" });
  f.get.mockResolvedValue(f.book); await Bun.sleep(1050);
  expect(events[1]).toMatchObject({ status: "ready", snapshot: { bookId: f.book.id } });
  lifetime.abort(); stop();
  const calls = f.get.mock.calls.length; await Bun.sleep(1050);
  expect(f.get.mock.calls).toHaveLength(calls);
  expect(() => observe(f.book.id, () => {})).toThrow();
});
