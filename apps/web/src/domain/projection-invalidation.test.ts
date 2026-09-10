import { expect, test } from "bun:test";
import type { ProjectionInvalidation } from "@read-aware/core";
import { emitAppEvent } from "../platform/app-events";
import { broadcastDomainEventDrafts } from "../platform/domain-events";
import { createProjectionInvalidationObserver } from "./projection-invalidation";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import { createIpcSyncStore } from "../platform/sync/sync-store";
import { restoreCollection, restoreLibraryBook } from "../features/library/lib/library-db";

const tick = () => Bun.sleep(0);
const manifest = { id: "invalidation", name: "Invalidation", version: "1", schemaVersion: 1, requires: {} };

test("authorized domain observers receive serial reload hints, not remote business events", async () => {
  const actor = buildPluginContext({ ...manifest, permissions: ["library:read", "conversations:read"] }, "1", []);
  const ungranted = buildPluginContext(manifest, "1", []);
  actor.lifecycle.promote();
  const library: ProjectionInvalidation[] = [], conversations: ProjectionInvalidation[] = [], events: unknown[] = [];
  const gate = Promise.withResolvers<void>();
  try {
    expect(ungranted.context.domains.library).toBeUndefined();
    expect(ungranted.context.domains.conversations).toBeUndefined();
    actor.context.domains.library!.events.observeInvalidation(async event => {
      library.push(event); if (event.revision === 1) await gate.promise;
    });
    actor.context.domains.conversations!.events.observeInvalidation(event => { conversations.push(event); });
    actor.context.domains.library!.events.subscribe("book.starred", event => { events.push(event); });
    expect(library).toEqual([{ revision: 1, source: "initial" }]);
    await tick();
    emitAppEvent("projections-invalidated", { source: "remote" });
    emitAppEvent("projections-invalidated", { source: "restore" });
    await tick();
    expect(events).toEqual([]);
    expect(library.length).toBe(1);
    expect(conversations.at(-1)).toEqual({ revision: 2, source: "mixed" });
    gate.resolve(); await tick();
    expect(library.at(-1)).toEqual({ revision: 2, source: "mixed" });
    broadcastDomainEventDrafts([{ type: "book.starred", payload: { bookId: "PRIVATE", starred: true } }]);
    await tick();
    expect(library.at(-1)).toEqual({ revision: 3, source: "local" });
    expect(conversations.length).toBe(2); expect(events.length).toBe(1);
    emitAppEvent("conversations-changed", {}); await tick();
    expect(conversations.at(-1)).toEqual({ revision: 3, source: "host" });
    expect(JSON.stringify(library)).not.toContain("PRIVATE");
    actor.lifecycle.stop();
    emitAppEvent("projections-invalidated", { source: "remote" }); await tick();
    expect(library.length).toBe(3); expect(conversations.length).toBe(3);
    expect(() => actor.context.domains.library!.events.observeInvalidation(() => {})).toThrow();
  } finally { gate.resolve(); actor.lifecycle.stop(); ungranted.lifecycle.stop(); }
});

test("observer limits, failed callbacks and disposal do not block peers or leak slots", async () => {
  const observe = createProjectionInvalidationObserver(() => true, []);
  const lifetime = new AbortController();
  const seen: ProjectionInvalidation[] = [];
  const off = observe(event => { seen.push(event); throw Error("controlled callback failure"); }, lifetime.signal);
  const subscriptions = Array.from({ length: 63 }, () => observe(() => {}));
  try {
    expect(() => observe(() => {})).toThrow("Too many");
    await tick(); emitAppEvent("projections-invalidated", { source: "remote" }); await tick();
    expect(seen.length).toBe(2);
    lifetime.abort(); off();
    const replacement = observe(() => {}); replacement();
    expect(() => observe(() => {}, lifetime.signal)).toThrow();
  } finally { off(); subscriptions.forEach(dispose => dispose()); }
});

test("sync notifications follow committed projection commands, including partial-cycle and backfill paths", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const actor = buildPluginContext({ ...manifest, permissions: ["library:read", "conversations:read"] }, "1", []);
  actor.lifecycle.promote();
  let result: unknown, failed = false;
  const gate = Promise.withResolvers<void>();
  let delayed = false;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: {
    invoke: async () => { if (delayed) await gate.promise; if (failed) throw { code: "db/locked", message: "private failure" }; return result; },
  } } });
  const seen: ProjectionInvalidation[] = [];
  actor.context.domains.library!.events.observeInvalidation(event => { seen.push(event); });
  const store = createIpcSyncStore();
  try {
    await tick(); result = { applied: 1, appended: 1, replayed: false }; delayed = true;
    const applying = store.applyRemote([]); await tick(); expect(seen.length).toBe(1);
    gate.resolve(); await applying; await tick(); expect(seen.at(-1)?.source).toBe("remote"); delayed = false;
    // A later cycle failure must not hide the earlier committed page.
    failed = true; await expect(store.applyRemote([])).rejects.toMatchObject({ code: "db/locked" });
    await tick(); expect(seen.length).toBe(2); failed = false;
    result = { applied: 0, appended: 0, replayed: false }; await store.applyRemote([]); await tick(); expect(seen.length).toBe(2);
    result = 3; await store.stageRemote([], []); await tick(); expect(seen.length).toBe(2);
    await store.finalizeStaged(); await tick(); expect(seen.length).toBe(3);
    result = {}; await store.restoreBootstrapCheckpoint("private-key"); await tick(); expect(seen.length).toBe(4);
    result = { replayed: false }; await store.backfillEvents([], []); await tick(); expect(seen.length).toBe(4);
    result = { replayed: true }; await store.backfillEvents([], []); await tick(); expect(seen.length).toBe(5);
    result = { complete: true }; await store.settleBackfill(); await tick(); expect(seen.length).toBe(6);
    await restoreCollection({ id: "restored", name: "Private" } as never); await tick(); expect(seen.at(-1)?.source).toBe("restore");
    await restoreLibraryBook({ id: "restored", title: "Private" } as never, null); await tick(); expect(seen.length).toBe(8);
    expect(JSON.stringify(seen)).not.toMatch(/private|Private/);
  } finally {
    gate.resolve(); actor.lifecycle.stop();
    if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window");
  }
});
