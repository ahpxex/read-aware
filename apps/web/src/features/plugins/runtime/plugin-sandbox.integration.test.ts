import { afterEach, expect, test } from "bun:test";
import { decodePluginCallbacks, type PluginCallbackWire } from "./plugin-callback-wire";

type Message = { t: string; id?: number; method?: string; args?: PluginCallbackWire; value?: PluginCallbackWire; ok?: boolean; error?: string };
const data = (wire: PluginCallbackWire) => decodePluginCallbacks(wire, handle => handle);
const resultData = (message: Message) => ({ ...message, value: message.value && data(message.value) });
const workers: Worker[] = [];
afterEach(() => { for (const worker of workers.splice(0)) worker.terminate(); });

function sandbox(scenario: string, fixture = "wire-probe.ts") {
  const worker = new Worker(new URL("./plugin-sandbox.worker.ts", import.meta.url), { type: "module" });
  workers.push(worker);
  const messages: Message[] = [];
  const listeners = new Set<() => void>();
  worker.onmessage = event => { messages.push(event.data); for (const listener of [...listeners]) listener(); };
  const next = (predicate: (message: Message) => boolean): Promise<Message> => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { listeners.delete(check); reject(new Error(`No matching sandbox message: ${JSON.stringify(messages)}`)); }, 3000);
    const check = () => {
      const failed = messages.find(message => message.t === "failed");
      if (failed) { clearTimeout(timeout); listeners.delete(check); reject(new Error(failed.error)); return; }
      const index = messages.findIndex(predicate);
      if (index < 0) return;
      clearTimeout(timeout); listeners.delete(check); resolve(messages.splice(index, 1)[0]);
    };
    listeners.add(check); check();
  });
  worker.postMessage({
    t: "boot", url: new URL(`./fixtures/${fixture}`, import.meta.url).href,
    manifest: { id: "wire-test", name: "Wire test", description: scenario, version: "1.0.0", schemaVersion: 1 },
    appVersion: "1.0.0", capabilities: {}, locale: "en", phase: "activating", storage: {},
    shape: { services: { network: { fetch: "fn" } }, contributions: { commands: { register: "fn" } }, __collection: { put: "fn", get: "fn" } },
  });
  return { worker, messages, next };
}

async function command(scenario: string) {
  const s = sandbox(scenario);
  const registration = await s.next(message => message.method === "contributions.commands.register");
  const handle = (data(registration.args!) as { run: () => string }[])[0].run();
  s.worker.postMessage({ t: "result", id: registration.id, ok: true, value: null, disposable: "registration" });
  await s.next(message => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "active" } });
  s.worker.postMessage({ t: "invoke", id: 900, handle, args: [] });
  return s;
}

test("real Worker preserves Request semantics, binary responses and authoritative storage acknowledgements", async () => {
  const s = await command("request-storage");
  const fetch = await s.next(message => message.method === "services.network.fetch");
  const [url, init] = data(fetch.args!) as [string, RequestInit];
  expect(url).toBe("https://example.test/file"); expect(init.method).toBe("PUT");
  expect(new Headers(init.headers).get("x-token")).toBe("test");
  expect([...new Uint8Array(init.body as ArrayBuffer)]).toEqual([0, 255]);
  s.worker.postMessage({ t: "result", id: fetch.id, ok: true, value: { status: 200, statusText: "OK", url, headers: [], body: new TextEncoder().encode("stored").buffer } });
  const write = await s.next(message => message.method === "services.storage.set");
  s.worker.postMessage({ t: "health", id: 901 }); await s.next(message => message.t === "healthy");
  expect(s.messages.some(message => message.t === "result" && message.id === 900)).toBe(false);
  s.worker.postMessage({ t: "sync", patch: { storage: { result: '"stored"' } } });
  s.worker.postMessage({ t: "result", id: write.id, ok: true, value: null });
  expect(resultData(await s.next(message => message.t === "result" && message.id === 900))).toMatchObject({ ok: true, value: { toast: "stored" } });
});

test("real Worker transports marker data, awaitable disposables and explicit callback release", async () => {
  const s = sandbox("callbacks", "callback-probe.ts");
  const main = await s.next(message => message.method === "contributions.commands.register");
  const mainHandle = (data(main.args!) as { run: () => string }[])[0].run();
  s.worker.postMessage({ t: "result", id: main.id, ok: true, value: null, disposable: "main" });
  await s.next(message => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "active" } });
  s.worker.postMessage({ t: "invoke", id: 910, handle: mainHandle, args: [] });
  const temporary = await s.next(message => message.method === "contributions.commands.register");
  const temporaryHandle = (data(temporary.args!) as { run: () => string }[])[0].run();
  s.worker.postMessage({ t: "result", id: temporary.id, ok: true, value: null, disposable: "temporary" });
  const put = await s.next(message => message.method?.endsWith(".put") === true);
  const marker = (data(put.args!) as unknown[])[1];
  expect(marker).toMatchObject({ __fn: "h1", __disposable: "d1", nested: [{ __fn: "h2", ordinary: true }] });
  expect(put.args!.callbacks).toHaveLength(0);
  s.worker.postMessage({ t: "result", id: put.id, ok: true, value: null });
  const get = await s.next(message => message.method?.endsWith(".get") === true);
  s.worker.postMessage({ t: "result", id: get.id, ok: true, value: { data: marker } });
  const view = await s.next(message => message.t === "result" && message.id === 910);
  const result = data(view.value!) as { view: { actions: { run: () => string }[] } };
  s.worker.postMessage({ t: "invoke", id: 911, handle: result.view.actions[0].run(), args: [] });
  expect(await s.next(message => message.t === "dispose")).toMatchObject({ handle: "temporary" });
  s.worker.postMessage({ t: "release", handles: temporary.args!.callbacks.map(entry => entry.handle) });
  const barrier = await s.next(message => message.method?.endsWith(".get") === true);
  s.worker.postMessage({ t: "result", id: barrier.id, ok: true, value: { data: marker } });
  expect(resultData(await s.next(message => message.t === "result" && message.id === 911))).toMatchObject({ ok: true, value: { toast: "released" } });
  s.worker.postMessage({ t: "invoke", id: 912, handle: temporaryHandle, args: [] });
  expect(await s.next(message => message.t === "result" && message.id === 912)).toMatchObject({ ok: false, code: "plugin/unavailable" });
  expect(s.messages.some(message => message.t === "dispose")).toBe(false);
  s.worker.postMessage({ t: "release", handles: view.value!.callbacks.map(entry => entry.handle) });
});

test("real Worker releases late registration receipts without interpreting business markers", async () => {
  const s = await command("pre-abort");
  await s.next(message => message.t === "result" && message.id === 900);
  s.worker.postMessage({ t: "result", id: 998, ok: true, value: { __disposable: "ordinary" } });
  s.worker.postMessage({ t: "result", id: 999, ok: true, value: null, disposable: "late-registration" });
  expect(await s.next(message => message.t === "dispose")).toMatchObject({ handle: "late-registration" });
  s.worker.postMessage({ t: "health", id: 913 });
  await s.next(message => message.t === "healthy" && message.id === 913);
  expect(s.messages.some(message => message.t === "dispose")).toBe(false);
});

test("real Worker rejects pre-aborted fetch without issuing a host request", async () => {
  const s = await command("pre-abort");
  expect(resultData(await s.next(message => message.t === "result" && message.id === 900))).toMatchObject({ ok: true, value: { toast: "already stopped" } });
  expect(s.messages.some(message => message.method === "services.network.fetch")).toBe(false);
});

test("real Worker forwards in-flight cancellation and ignores a late response", async () => {
  const s = await command("live-abort");
  const request = await s.next(message => message.method === "services.network.fetch");
  expect(await s.next(message => message.t === "cancel")).toMatchObject({ id: request.id });
  expect(resultData(await s.next(message => message.t === "result" && message.id === 900))).toMatchObject({ ok: true, value: { toast: "stopped" } });
  s.worker.postMessage({ t: "result", id: request.id, ok: false, error: "late" });
  s.worker.postMessage({ t: "health", id: 902 });
  expect(await s.next(message => message.t === "healthy")).toMatchObject({ id: 902 });
});

test("real Worker migration drains unawaited storage calls before returning migrated", async () => {
  const s = sandbox("migration");
  const registration = await s.next(message => message.method === "contributions.commands.register");
  s.worker.postMessage({ t: "result", id: registration.id, ok: true, value: null, disposable: "registration" });
  await s.next(message => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "migrating" } });
  s.worker.postMessage({ t: "migrate", id: 903, migration: { from: 1, to: 2, direction: "upgrade" } });
  const write = await s.next(message => message.method === "services.storage.set");
  s.worker.postMessage({ t: "health", id: 904 }); await s.next(message => message.t === "healthy");
  expect(s.messages.some(message => message.t === "migrated")).toBe(false);
  s.worker.postMessage({ t: "result", id: write.id, ok: false, code: "db/locked", error: "write failed" });
  expect(await s.next(message => message.t === "migrated")).toMatchObject({ id: 903, ok: false, error: "write failed" });
});
