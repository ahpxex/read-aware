import { expect, test } from "bun:test";
import { AppError, type BookContentObservation, type BookContentState } from "@read-aware/core";
import { createContentStateObserver, getBookContentState } from "./book-content-state";
import { localKV, flushLocalKV } from "../platform/local-store";
import { bindVirtualBook } from "../features/plugins/lib/virtual-books";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import { createLibraryPort } from "../features/ai/agent/ports/library-port";
import { readingRuntime } from "./reading-runtime";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("source queries report local metadata, provider changes and invalidation without loading content or disclosing reading", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const bookId = "content-state", key = "read-aware-virtual-books";
  let format = "virtual", exists = true, local = true, failure = false;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: {
    invoke: async (command: string) => {
      if (failure) throw { code: "db/locked", message: "private storage failure" };
      const row = { id: bookId, title: "Book", format, coverStatus: "none" };
      if (command === "library_get_book") return exists ? row : null;
      if (command === "library_load") return exists ? [row] : [];
      if (command === "get_blob_info") return local ? { sha256: "hash", byteSize: 20, mimeType: "private" } : null;
      if (command === "set_kv" || command === "delete_kv") return;
      throw Error(`Unexpected IPC: ${command}`);
    },
  } } });
  const saved = localKV.getItem(key);
  const owner = buildPluginContext({ id: "content-owner", name: "Owner", version: "1", schemaVersion: 1, requires: {}, permissions: ["library:write"] }, "0.5.4", []);
  const reader = buildPluginContext({ id: "content-reader", name: "Reader", version: "1", schemaVersion: 1, requires: {}, permissions: ["library:read"] }, "0.5.4", []);
  const ungranted = buildPluginContext({ id: "content-none", name: "None", version: "1", schemaVersion: 1, requires: {} }, "0.5.4", []);
  try {
    owner.lifecycle.promote(); reader.lifecycle.promote();
    let loads = 0;
    const register = () => owner.context.contributions.contentProviders.register({ id: "feed", load: async () => { loads++; throw Error("Must not load"); } });
    let provider = register();
    bindVirtualBook(bookId, { pluginId: "content-owner", providerId: "feed", key: "private-feed-key" });
    await flushLocalKV();
    const query = () => reader.context.domains.library!.queries.books.getContentState(bookId);
    const first = await query();
    expect(first).toMatchObject({ bookId, source: "virtual", availability: "provider-registered", contentVersion: null });
    expect(Object.keys(first).sort()).toEqual(["availability", "bookId", "contentVersion", "source", "sourceRevision"]);
    expect(JSON.stringify(first)).not.toContain("private-feed-key");
    expect(reader.context.domains.reading).toBeUndefined(); expect(ungranted.context.domains.library).toBeUndefined();
    expect(await createLibraryPort().getContentState(bookId)).toEqual(first);
    const session = readingRuntime.begin(bookId), location = { bookId, contentVersion: "old-content", fraction: 0 };
    readingRuntime.attach(session, { sourceRevision: first.sourceRevision, navigate: async () => location, step: async () => location }, location);
    const observations: BookContentObservation[] = [];
    const subscription = reader.context.domains.library!.events.observeContentState(bookId, event => { observations.push(event); });
    await tick(); subscription.dispose();
    expect(observations).toEqual([{ status: "ready", snapshot: first }]);
    await owner.context.domains.library!.commands!.books.invalidateVirtualBook({ providerId: "feed", key: "private-feed-key" });
    const invalidated = await query(); expect(invalidated.sourceRevision).not.toBe(first.sourceRevision);
    expect(readingRuntime.snapshot().sourceRevision).toBe(first.sourceRevision);
    provider.dispose(); expect((await query()).availability).toBe("provider-unavailable");
    provider = register(); const replaced = await query(); expect(replaced.sourceRevision).not.toBe(invalidated.sourceRevision);
    bindVirtualBook(bookId, { pluginId: "content-owner", providerId: "feed", key: "another-private-key" }); await flushLocalKV();
    expect((await query()).sourceRevision).not.toBe(replaced.sourceRevision);
    expect(loads).toBe(0);
    readingRuntime.fail(session, Error("failed")); expect(readingRuntime.snapshot().sourceRevision).toBeNull();
    format = "epub";
    expect(await query()).toEqual({ bookId, source: "file", availability: "local", sourceRevision: "sha256:hash", contentVersion: "sha256:hash" });
    local = false; expect((await query()).availability).toBe("missing");
    failure = true; await expect(query()).rejects.toMatchObject({ code: "db/locked" }); failure = false;
    exists = false; await expect(query()).rejects.toMatchObject({ code: "library/book-not-found" });
    reader.lifecycle.stop(); expect(query).toThrow();
    await expect(getBookContentState("")).rejects.toMatchObject({ code: "ui/invalid-target" });
  } finally {
    failure = false; owner.lifecycle.stop(); reader.lifecycle.stop(); ungranted.lifecycle.stop(); readingRuntime.closed();
    if (saved === null) localKV.removeItem(key); else localKV.setItem(key, saved);
    await flushLocalKV();
    if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window");
  }
});

test("content observation serializes delivery, deduplicates snapshots and reports errors then recovery", async () => {
  const lifetime = new AbortController(), scheduled = new Set<() => void>(), seen: BookContentObservation[] = [], errors: unknown[] = [];
  let snapshot: BookContentState = { bookId: "book", source: "virtual", availability: "provider-registered", sourceRevision: "one", contentVersion: null };
  let failure = false, release!: () => void, slow = true;
  const observe = createContentStateObserver(lifetime.signal, {
    read: async () => { if (failure) throw new AppError("db/locked", "private"); return snapshot; },
    report: error => { errors.push(error); },
    schedule: work => { scheduled.add(work); return () => { scheduled.delete(work); }; },
  });
  const off = observe("book", async event => {
    seen.push(structuredClone(event));
    if (event.status === "ready") event.snapshot.sourceRevision = "mutated";
    if (slow) await new Promise<void>(resolve => { release = resolve; });
  });
  await tick(); expect(scheduled.size).toBe(0); expect(snapshot.sourceRevision).toBe("one");
  slow = false; release(); await tick();
  const poll = async () => { const work = [...scheduled][0]!; scheduled.delete(work); work(); await tick(); };
  await poll(); expect(seen).toHaveLength(1);
  failure = true; await poll(); expect(seen[1]).toEqual({ status: "error", errorCode: "db/locked" });
  await poll(); expect(seen).toHaveLength(2);
  failure = false; snapshot = { ...snapshot, sourceRevision: "two" }; await poll();
  expect(seen[2]).toEqual({ status: "ready", snapshot }); expect(errors.length).toBe(2);
  lifetime.abort(); expect(scheduled.size).toBe(0); off();
  expect(() => observe("book", () => {})).toThrow();
});

test("content observations cap each owner and suppress a late read after disposal", async () => {
  let finish!: (state: BookContentState) => void;
  const pending = new Promise<BookContentState>(resolve => { finish = resolve; });
  const observe = createContentStateObserver(undefined, { read: () => pending, report: () => {}, schedule: () => () => {} });
  let deliveries = 0;
  const stops = Array.from({ length: 64 }, () => observe("book", () => { deliveries++; }));
  expect(() => observe("book", () => {})).toThrow();
  for (const stop of stops) stop();
  finish({ bookId: "book", source: "file", availability: "missing", sourceRevision: "missing", contentVersion: null });
  await tick(); expect(deliveries).toBe(0);
  const stop = observe("book", () => {}); stop();
});
