import { expect, test } from "bun:test";
import type { PluginSyncTransportSession } from "@read-aware/plugin-types";
import { ownTransportSession } from "./transport-session";
import { findSyncTransport, invalidateSyncTransportSessions, registerSyncTransport } from "./transport-registry";
import { TransportSessionCache } from "./transport-session-cache";
import { withTransportSession } from "./transport-session-scope";
import { decodePluginCallbacks, PluginCallbackRegistry, releasePluginCallbacks } from "../../features/plugins/runtime/plugin-callback-wire";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(overrides: Partial<PluginSyncTransportSession> = {}): PluginSyncTransportSession {
  return {
    endpointId: "endpoint", async close() {}, async probe() {}, async getMeta() { return null; },
    async putMetaIfAbsent() { return "stored"; }, async listEventBatches() { return []; },
    async getEventBatch() { return []; }, async putEventBatch() {}, async putBlob() {},
    async getBlob() { return null; }, async putBlobPart() {}, async commitBlob() {},
    async getBlobPart() { return new Uint8Array(); }, ...overrides,
  };
}

test("closing cancels waiters, rejects late success and releases only session callbacks", async () => {
  const registry = new PluginCallbackRegistry();
  const work = deferred<void>(), close = deferred<void>();
  let calls = 0, closes = 0, disposed = 0;
  const provider = registry.encode(() => {});
  const wire = registry.encode(fixture({ probe: () => { calls++; return work.promise; }, close: () => { closes++; return close.promise; } }));
  const raw = decodePluginCallbacks(wire, (handle, args) => registry.invoke(handle, args), handles => registry.release(handles)) as PluginSyncTransportSession;
  const managed = ownTransportSession(raw, releasePluginCallbacks, () => { disposed++; });
  const pending = managed.probe();
  await Promise.resolve();
  const closing = managed.close();
  expect(managed.close()).toBe(closing);
  await expect(pending).rejects.toMatchObject({ code: "plugin/unavailable" });
  await expect(managed.probe()).rejects.toMatchObject({ code: "plugin/unavailable" });
  expect(calls).toBe(1);
  expect(disposed).toBe(0);
  close.resolve();
  await closing;
  work.resolve();
  expect(closes).toBe(1); expect(disposed).toBe(1);
  expect(registry.size).toBe(provider.callbacks.length);
  await expect(raw.probe()).rejects.toMatchObject({ code: "plugin/unavailable" });
});

test("close failures and deadlines still release resources and cannot revive a session", async () => {
  for (const close of [async () => { throw new Error("close failed"); }, () => new Promise<void>(() => {})]) {
    let releases = 0, disposed = 0;
    const session = ownTransportSession(fixture({ close }), () => { releases++; }, () => { disposed++; }, 5);
    await expect(session.close()).rejects.toBeDefined();
    expect(releases).toBe(1); expect(disposed).toBe(1);
    await expect(session.getMeta("key")).rejects.toMatchObject({ code: "plugin/unavailable" });
  }
});

test("unregister closes published and late sessions; stale providers cannot reopen", async () => {
  const opening = deferred<PluginSyncTransportSession>();
  let closed = 0, released = 0, calls = 0;
  const unregister = registerSyncTransport("session-test", {
    id: "late", label: "Late", open: () => ++calls === 1 ? Promise.resolve(fixture({ close: async () => { closed++; } })) : opening.promise,
  }, () => { released++; });
  const provider = findSyncTransport("plugin:session-test:late")!;
  const first = await provider.open();
  const pending = provider.open();
  await unregister();
  expect(closed).toBe(1);
  await expect(first.probe()).rejects.toMatchObject({ code: "plugin/unavailable" });
  opening.resolve(fixture({ close: async () => { closed++; } }));
  await expect(pending).rejects.toMatchObject({ code: "plugin/unavailable" });
  await expect(provider.open()).rejects.toMatchObject({ code: "plugin/unavailable" });
  expect(closed).toBe(2); expect(released).toBe(2); expect(calls).toBe(2);
  await unregister();
});

test("replacement retires old sessions but the old disposer cannot remove the new provider", async () => {
  const first = registerSyncTransport("session-test", { id: "replace", label: "First", open: async () => fixture() });
  const old = findSyncTransport("plugin:session-test:replace")!;
  const session = await old.open();
  const second = registerSyncTransport("session-test", { id: "replace", label: "Second", open: async () => fixture() });
  try {
    await first();
    expect(findSyncTransport(old.ref)?.label).toBe("Second");
    await expect(old.open()).rejects.toMatchObject({ code: "plugin/unavailable" });
    await expect(session.probe()).rejects.toMatchObject({ code: "plugin/unavailable" });
  } finally { await second(); }
});

test("cache keys provider identity and endpoint, closes mismatches, and never reopens a stopped engine", async () => {
  let opened = 0, closed = 0;
  const provider = { ref: "ref", pluginId: "test", transportId: "test", label: "Test", generation: 0, open: async () => {
    opened++; return fixture({ close: async () => { closed++; } });
  } };
  const cache = new TransportSessionCache(() => provider, error => { throw error; });
  const connection = { ref: "ref", endpointId: "endpoint" };
  const first = await cache.get(connection);
  expect(await cache.get(connection)).toBe(first);
  expect(opened).toBe(1);
  await expect(cache.get({ ...connection, endpointId: "wrong" })).rejects.toMatchObject({ code: "sync/transport-mismatch" });
  expect(closed).toBe(2);
  await cache.get(connection);
  cache.stop();
  await expect(cache.get(connection)).rejects.toMatchObject({ code: "plugin/unavailable" });
  expect(opened).toBe(3); expect(closed).toBe(3);
});

test("cache invalidates pending opens without leaking the late session", async () => {
  const opening = deferred<PluginSyncTransportSession>();
  let closed = 0;
  const provider = { ref: "ref", pluginId: "test", transportId: "test", label: "Test", generation: 0, open: () => opening.promise };
  const cache = new TransportSessionCache(() => provider, error => { throw error; });
  const pending = cache.get({ ref: "ref", endpointId: "endpoint" });
  cache.stop();
  opening.resolve(fixture({ close: async () => { closed++; } }));
  await expect(pending).rejects.toMatchObject({ code: "plugin/unavailable" });
  expect(closed).toBe(1);
});

test("invalid returned sessions are closed and released before rejection", async () => {
  let closed = 0, released = 0;
  const unregister = registerSyncTransport("session-test", {
    id: "invalid", label: "Invalid", open: async () => ({ endpointId: "x", close: async () => { closed++; } } as PluginSyncTransportSession),
  }, () => { released++; });
  try {
    await expect(findSyncTransport("plugin:session-test:invalid")!.open()).rejects.toMatchObject({ code: "plugin/invalid-input" });
    expect(closed).toBe(1); expect(released).toBe(1);
  } finally { await unregister(); }
});

test("connection rituals close on success and failure without masking the original failure", async () => {
  let closed = 0;
  expect(await withTransportSession(fixture({ close: async () => { closed++; } }), async () => "ready")).toBe("ready");
  expect(closed).toBe(1);
  const operationError = new Error("wrong passphrase"), cleanupError = new Error("close failed");
  const session = fixture({ close: async () => { throw cleanupError; } });
  await expect(withTransportSession(session, async () => { throw operationError; })).rejects.toBe(operationError);
  await expect(withTransportSession(session, async () => "ready")).rejects.toBe(cleanupError);
});

test("unrelated registry changes preserve a cached session; replacement closes it", async () => {
  let closed = 0;
  let provider = { ref: "ref", pluginId: "test", transportId: "test", label: "Test", generation: 0, open: async () => fixture({ close: async () => { closed++; } }) };
  const cache = new TransportSessionCache(() => provider, error => { throw error; });
  const connection = { ref: "ref", endpointId: "endpoint" };
  const first = await cache.get(connection);
  cache.refresh();
  expect(await cache.get(connection)).toBe(first);
  expect(closed).toBe(0);
  provider = { ...provider };
  cache.refresh();
  expect(closed).toBe(1);
  expect(await cache.get(connection)).not.toBe(first);
  cache.stop();
  expect(closed).toBe(2);
});

test("configuration changes close cached sessions and late opens before resolving the new endpoint", async () => {
  const opening = deferred<PluginSyncTransportSession>();
  let calls = 0, closed = 0;
  const unregister = registerSyncTransport("session-test", { id: "config", label: "Config", open: async () => {
    calls++;
    if (calls === 2) return opening.promise;
    return fixture({ endpointId: calls === 1 ? "old" : "new", close: async () => { closed++; } });
  } });
  const provider = findSyncTransport("plugin:session-test:config")!;
  const cache = new TransportSessionCache(findSyncTransport, error => { throw error; });
  try {
    const first = await cache.get({ ref: provider.ref, endpointId: "old" });
    const late = provider.open();
    invalidateSyncTransportSessions("session-test");
    await expect(first.probe()).rejects.toMatchObject({ code: "plugin/unavailable" });
    opening.resolve(fixture({ close: async () => { closed++; } }));
    await expect(late).rejects.toMatchObject({ code: "plugin/unavailable" });
    await expect(cache.get({ ref: provider.ref, endpointId: "old" })).rejects.toMatchObject({ code: "sync/transport-mismatch" });
    expect((await cache.get({ ref: provider.ref, endpointId: "new" })).endpointId).toBe("new");
    expect(closed).toBe(3);
  } finally { cache.stop(); await unregister(); }
});
