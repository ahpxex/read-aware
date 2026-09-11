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

test("EOF releases accounting without aborting or cancelling a completed native response", async () => {
  for (const status of [200, 503]) {
    let aborts = 0, cancellations = 0;
    const h = owner(async (_input, init) => {
      init.signal!.addEventListener("abort", () => { aborts++; });
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array([7, 8])); controller.close(); },
        cancel() { cancellations++; },
      }), { status });
    }, { maxConcurrentRequests: 1 });
    const response = await h.api.fetch("https://a.test");
    expect(response.status).toBe(status);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([7, 8]);
    await Promise.all(h.cleanups);
    expect(aborts).toBe(0); expect(cancellations).toBe(0);
    const next = await h.api.open("https://a.test");
    await h.api.close(next.id);
    expect(aborts).toBe(1);
    h.controller.abort(); await Promise.all(h.cleanups);
    expect(aborts).toBe(1);
  }
});

test("native transport and body failures carry network codes while structured failures survive", async () => {
  for (const failure of [new TypeError("Private transport detail"), "private native failure"]) {
    const { api, cleanups } = owner(async () => { throw failure; });
    await expect(api.open("https://a.test")).rejects.toMatchObject({ code: "plugin/network-failed", retryable: true, cause: failure });
    await Promise.all(cleanups);
  }
  const denied = Object.assign(new Error("Not granted"), { code: "plugin/network-denied" });
  const h = owner(async () => { throw denied; });
  await expect(h.api.open("https://a.test")).rejects.toBe(denied);
  const failure = new TypeError("Private body failure");
  const body = owner(async () => new Response(new ReadableStream({ pull() { throw failure; } }, { highWaterMark: 0 })));
  const response = await body.api.fetch("https://a.test");
  await expect(response.text()).rejects.toMatchObject({ code: "plugin/network-failed", cause: failure });
});

test("caller deadlines and cancellation are distinct before and during transport", async () => {
  for (const name of ["TimeoutError", "AbortError"]) {
    const code = name === "TimeoutError" ? "plugin/network-timeout" : "plugin/cancelled";
    const before = new AbortController(); before.abort(new DOMException("private reason", name));
    const h = owner(async () => new Response());
    await expect(h.api.fetch("https://a.test", { signal: before.signal })).rejects.toMatchObject({ code });
    const started = deferred<void>(), done = deferred<Response>(), controller = new AbortController();
    const live = owner(async () => { started.resolve(); return done.promise; });
    const request = live.api.open("https://a.test", { signal: controller.signal });
    await started.promise;
    controller.abort(new DOMException("private reason", name));
    await expect(request).rejects.toMatchObject({ code });
    done.resolve(new Response());
    await Promise.all(live.cleanups);
  }
});

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
