import { afterEach, expect, test } from "bun:test";
import { PluginNetworkRequests, PLUGIN_NETWORK_LIMITS } from "./plugin-network-requests";

const owners: { controller: AbortController; cleanups: Promise<void>[] }[] = [];
afterEach(async () => {
  for (const entry of owners.splice(0)) {
    entry.controller.abort(new Error("test teardown"));
    await Promise.all(entry.cleanups);
  }
});

function owner(request: (input: RequestInfo | URL, init: RequestInit) => Promise<Response>,
  limits: Partial<typeof PLUGIN_NETWORK_LIMITS> = {}) {
  const controller = new AbortController();
  const cleanups: Promise<void>[] = [];
  owners.push({ controller, cleanups });
  return { api: new PluginNetworkRequests(request, controller.signal, pending => cleanups.push(pending), { ...PLUGIN_NETWORK_LIMITS, ...limits }), controller, cleanups };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

test("pull reads return bounded exact bytes with sequential offsets, no replay or foreign handles", async () => {
  let pulls = 0;
  const { api, cleanups } = owner(async () => new Response(new ReadableStream({
    pull(controller) { pulls++; if (pulls === 1) controller.enqueue(new Uint8Array([0, 1, 255, 3, 4])); else controller.close(); },
  }, { highWaterMark: 0 })));
  const response = await api.open("https://a.test");
  expect(pulls).toBe(0);
  expect(response.expiresAt).toBeGreaterThan(Date.now());
  const other = owner(async () => new Response());
  await expect(other.api.read(response.id, 0)).rejects.toMatchObject({ code: "plugin/network-closed" });
  await other.api.close(response.id);
  const first = await api.read(response.id, 0, 2);
  expect(first.offset).toBe(0); expect([...new Uint8Array(first.bytes)]).toEqual([0, 1]); expect(first.done).toBe(false);
  expect(pulls).toBe(1);
  await expect(api.read(response.id, 0)).rejects.toMatchObject({ code: "plugin/network-read-invalid" });
  for (const size of [0, -1, NaN, 1.5, 1024 * 1024 + 1]) await expect(api.read(response.id, 2, size)).rejects.toMatchObject({ code: "plugin/network-read-invalid" });
  const second = await api.read(response.id, 2, 10);
  expect([...new Uint8Array(second.bytes)]).toEqual([255, 3, 4]); expect(pulls).toBe(1);
  expect(await api.read(response.id, 5)).toEqual({ offset: 5, bytes: new ArrayBuffer(0), done: true });
  await Promise.all(cleanups);
  await expect(api.read(response.id, 5)).rejects.toMatchObject({ code: "plugin/network-closed" });
  await api.close(response.id); await api.close(response.id);
});

test("fetch and streams share per-activation slots through headers and body cleanup", async () => {
  let calls = 0;
  const finishCancel = deferred<void>();
  const { api } = owner(async () => { calls++; return new Response(new ReadableStream({ cancel() { return finishCancel.promise; } })); }, { maxConcurrentRequests: 2 });
  const stream = await api.open("https://a.test");
  const response = await api.fetch("https://a.test");
  await expect(api.open("https://a.test")).rejects.toMatchObject({ code: "plugin/network-busy" });
  await expect(api.fetch("https://a.test")).rejects.toMatchObject({ code: "plugin/network-busy" });
  expect(calls).toBe(2);
  const closing = api.close(stream.id);
  await expect(api.open("https://a.test")).rejects.toMatchObject({ code: "plugin/network-busy" });
  finishCancel.resolve(); await closing;
  const next = await api.open("https://a.test");
  expect(calls).toBe(3);
  await response.body!.cancel(); await api.close(next.id);
});

test("host-wide slots are shared between activations, not bypassed with extra owners", async () => {
  const a = owner(async () => new Response(), { maxHostConcurrentRequests: 2 });
  const b = owner(async () => new Response(), { maxHostConcurrentRequests: 2 });
  const first = await a.api.open("https://a.test"), second = await b.api.open("https://b.test");
  await expect(b.api.open("https://b.test")).rejects.toMatchObject({ code: "plugin/network-busy" });
  await a.api.close(first.id);
  const third = await b.api.open("https://b.test");
  await b.api.close(second.id); await b.api.close(third.id);
});

test("a slow opening cancelled before headers retains its slot until the native operation settles", async () => {
  const late = deferred<Response>();
  let disposed = false;
  const { api, cleanups } = owner(() => late.promise, { maxConcurrentRequests: 1 });
  const controller = new AbortController();
  const pending = api.open("https://a.test", { signal: controller.signal }).catch(error => error);
  await Promise.resolve();
  controller.abort(new Error("stop opening"));
  expect((await pending).message).toBe("stop opening");
  await expect(api.open("https://a.test")).rejects.toMatchObject({ code: "plugin/network-busy" });
  late.resolve(new Response(new ReadableStream({ cancel() { disposed = true; } })));
  await Promise.all(cleanups); expect(disposed).toBe(true);
});

test("close and retirement cancel a pending read and reject overlapping reads", async () => {
  for (const retire of [false, true]) {
    let disposed = false;
    const { api, controller, cleanups } = owner(async () => new Response(new ReadableStream({ cancel() { disposed = true; } })));
    const stream = await api.open("https://a.test");
    const read = api.read(stream.id, 0);
    await expect(api.read(stream.id, 0)).rejects.toMatchObject({ code: "plugin/network-busy" });
    if (retire) controller.abort(new Error("unloaded")); else void api.close(stream.id);
    await expect(read).rejects.toThrow();
    await Promise.all(cleanups); expect(disposed).toBe(true);
  }
});

test("absolute stream deadline expires without polling and bounds pending reads", async () => {
  let disposed = false;
  const { api, cleanups } = owner(async () => new Response(new ReadableStream({ cancel() { disposed = true; } })), { timeoutMs: 20 });
  const stream = await api.open("https://a.test");
  await expect(api.read(stream.id, 0)).rejects.toMatchObject({ code: "plugin/network-timeout" });
  await Promise.all(cleanups); expect(disposed).toBe(true);
  await expect(api.read(stream.id, 0)).rejects.toMatchObject({ code: "plugin/network-closed" });
});

test("stream byte caps fail before publishing the overflowing chunk and clean up", async () => {
  let disposed = false;
  const { api, cleanups } = owner(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); }, cancel() { disposed = true; },
  })), { maxStreamBytes: 2 });
  const stream = await api.open("https://a.test");
  await expect(api.read(stream.id, 0)).rejects.toMatchObject({ code: "plugin/payload-too-large" });
  await Promise.all(cleanups); expect(disposed).toBe(true);
});

test("fetch preserves caller cancellation after headers; openStream uses explicit close after receipt", async () => {
  const { api } = owner(async () => new Response(new ReadableStream({})));
  const controller = new AbortController();
  const response = await api.fetch("https://a.test", { signal: controller.signal });
  const pending = response.text(); controller.abort(new Error("stop body"));
  await expect(pending).rejects.toThrow("stop body");
  const streamController = new AbortController();
  const stream = await api.open("https://a.test", { signal: streamController.signal });
  streamController.abort();
  const read = api.read(stream.id, 0);
  const closed = api.close(stream.id);
  await expect(read).rejects.toMatchObject({ code: "plugin/network-closed" });
  await closed;
});
