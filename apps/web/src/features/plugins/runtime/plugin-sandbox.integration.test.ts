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
    shape: { domains: { library: { queries: { books: { searchLocations: "fn" } } }, reading: { commands: { step: "fn" } } }, services: { llm: { ask: "fn", askDetailed: "fn", policy: "fn" }, logging: { write: "fn", policy: "fn" }, network: { fetch: "fn", openStream: "fn", readStream: "fn", closeStream: "fn" } }, contributions: { commands: { register: "fn" } }, __collection: { put: "fn", get: "fn", page: "fn" } },
  });
  return { worker, messages, next };
}

async function command(scenario: string, fixture?: string) {
  const s = sandbox(scenario, fixture);
  const registration = await s.next(message => message.method === "contributions.commands.register");
  const handle = (data(registration.args!) as { run: () => string }[])[0].run();
  s.worker.postMessage({ t: "result", id: registration.id, ok: true, value: null, disposable: "registration" });
  await s.next(message => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "active" } });
  s.worker.postMessage({ t: "invoke", id: 900, handle, args: [] });
  return s;
}

test.each(["query", "navigation"])("Worker %s cancellation strips options, preserves guards and drops late results", async kind => {
  const method = kind === "query" ? "domains.library.queries.books.searchLocations" : "domains.reading.commands.step";
  const pre = await command(`${kind}-pre`, "operation-cancel-probe.ts");
  expect(resultData(await pre.next(message => message.t === "result" && message.id === 900))).toMatchObject({ ok: true, value: { toast: "replaced" } });
  expect(pre.messages.some(message => message.method === method)).toBe(false);
  const live = await command(`${kind}-live`, "operation-cancel-probe.ts");
  const call = await live.next(message => message.method === method);
  expect(data(call.args!)).toEqual(kind === "query" ? [{ bookId: "b", query: "q" }, undefined] : ["next", { sessionId: "active" }, undefined]);
  expect(await live.next(message => message.t === "cancel")).toMatchObject({ id: call.id });
  expect(resultData(await live.next(message => message.t === "result" && message.id === 900))).toMatchObject({ ok: true, value: { toast: "replaced" } });
  live.worker.postMessage({ t: "result", id: call.id, ok: true, value: { late: true } });
  live.worker.postMessage({ t: "health", id: 993 }); await live.next(message => message.t === "healthy");
  expect(live.messages.some(message => message.t === "result" && message.id === 900)).toBe(false);
});

test.each(["ask", "askDetailed"])("Worker LLM %s cancellation keeps AbortSignal local and cancels only its outstanding request", async method => {
  const suffix = method === "askDetailed" ? "-detailed" : "";
  const pre = await command(`pre-abort${suffix}`, "llm-probe.ts");
  expect(resultData(await pre.next(message => message.t === "result" && message.id === 900))).toMatchObject({ ok: true, value: { toast: "stopped" } });
  expect(pre.messages.some(message => message.method === `services.llm.${method}`)).toBe(false);
  const live = await command(`live-abort${suffix}`, "llm-probe.ts");
  const call = await live.next(message => message.method === `services.llm.${method}`);
  expect(data(call.args!)).toEqual([{ prompt: "probe", timeoutMs: 5000 }]);
  expect(await live.next(message => message.t === "cancel")).toMatchObject({ id: call.id });
  expect(resultData(await live.next(message => message.t === "result" && message.id === 900))).toMatchObject({ ok: true, value: { toast: "stopped" } });
  live.worker.postMessage({ t: "result", id: call.id, ok: true, value: "late private output" });
  live.worker.postMessage({ t: "health", id: 992 }); await live.next(message => message.t === "healthy");
  expect(live.messages.some(message => message.t === "result" && message.id === 900)).toBe(false);
});

test("Worker detailed inference carries a plain output cap and receives the metadata envelope", async () => {
  const s = await command("detailed", "llm-probe.ts");
  const call = await s.next(message => message.method === "services.llm.askDetailed");
  expect(data(call.args!)).toEqual([{ prompt: "probe", maxOutputTokens: 128 }]);
  s.worker.postMessage({ t: "result", id: call.id, ok: true, value: { value: "ok", attempts: [{ usage: null, estimatedCostUsd: null }] } });
  expect(resultData(await s.next(message => message.t === "result" && message.id === 900))).toMatchObject({ ok: true, value: { toast: "ok:1" } });
});

test("Worker logging crosses normal and restricted migration contexts with structured receipts", async () => {
  const s = sandbox("logging", "logging-probe.ts");
  const activation = await s.next(message => message.method === "services.logging.write");
  expect(data(activation.args!)).toEqual([{ level: "info", event: "activation.started", fields: { attempt: 1 } }]);
  s.worker.postMessage({ t: "result", id: activation.id, ok: true, value: { status: "accepted" } });
  await s.next(message => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "migrating" } });
  s.worker.postMessage({ t: "migrate", id: 990, migration: { fromVersion: 1, toVersion: 2, direction: "upgrade" } });
  const migration = await s.next(message => message.method === "services.logging.write");
  expect(data(migration.args!)).toEqual([{ level: "warn", event: "migration.failed", errorCode: "db/locked" }]);
  s.worker.postMessage({ t: "result", id: migration.id, ok: true, value: { status: "rate-limited", retryAfterMs: 1000 } });
  expect(await s.next(message => message.t === "migrated")).toMatchObject({ id: 990, ok: true });
});

test("Worker storage override retains document pages and conditional transactions", async () => {
  const s = await command("documents", "document-probe.ts");
  const page = await s.next(message => message.method === "services.storage.collection(words).page");
  expect(data(page.args!)).toEqual([{ limit: 1 }]);
  s.worker.postMessage({ t: "result", id: page.id, ok: true, value: { status: "ready", items: [{ id: "word", revision: "a".repeat(32), data: {} }], nextCursor: null } });
  const apply = await s.next(message => message.method === "services.storage.applyDocuments");
  expect(data(apply.args!)).toEqual([[{ kind: "check", collection: "words", id: "word", expectedRevision: "a".repeat(32) }]]);
  s.worker.postMessage({ t: "result", id: apply.id, ok: true, value: { status: "conflict", index: 0 } });
  expect(resultData(await s.next(message => message.t === "result" && message.id === 900))).toMatchObject({ ok: true, value: { toast: "conflict" } });
});

test("Worker migration storage exposes conditional document commits and waits for acknowledgement", async () => {
  const s = sandbox("documents", "document-probe.ts");
  const registration = await s.next(message => message.method === "contributions.commands.register");
  s.worker.postMessage({ t: "result", id: registration.id, ok: true, value: null, disposable: "registration" });
  await s.next(message => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "migrating" } });
  s.worker.postMessage({ t: "migrate", id: 903, migration: { fromVersion: 1, toVersion: 2, direction: "upgrade" } });
  const write = await s.next(message => message.method === "services.storage.applyDocuments");
  expect(data(write.args!)).toEqual([[{ kind: "put", collection: "words", id: "seed", data: {}, expectedRevision: null }]]);
  s.worker.postMessage({ t: "health", id: 904 }); await s.next(message => message.t === "healthy");
  expect(s.messages.some(message => message.t === "migrated")).toBe(false);
  s.worker.postMessage({ t: "result", id: write.id, ok: true, value: { status: "applied", documents: [] } });
  expect(await s.next(message => message.t === "migrated")).toMatchObject({ id: 903, ok: true });
});

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

test("real Worker opens a Request stream then pulls binary chunks and closes its handle", async () => {
  const s = await command("stream");
  const open = await s.next(message => message.method === "services.network.openStream");
  const [url, init] = data(open.args!) as [string, RequestInit];
  expect(url).toBe("https://example.test/file"); expect(init.method).toBe("PUT");
  expect(new Headers(init.headers).get("x-token")).toBe("stream");
  expect([...new Uint8Array(init.body as ArrayBuffer)]).toEqual([0, 255]);
  s.worker.postMessage({ t: "result", id: open.id, ok: true, value: { id: "response-id", url, status: 200, statusText: "OK", headers: [], redirected: false, expiresAt: Date.now() + 120000 } });
  const first = await s.next(message => message.method === "services.network.readStream");
  expect(data(first.args!)).toEqual(["response-id", 0, 1024]);
  s.worker.postMessage({ t: "result", id: first.id, ok: true, value: { offset: 0, bytes: new Uint8Array([0, 255, 3]).buffer, done: false } });
  const second = await s.next(message => message.method === "services.network.readStream");
  expect(data(second.args!)).toEqual(["response-id", 3, 1024]);
  s.worker.postMessage({ t: "result", id: second.id, ok: true, value: { offset: 3, bytes: new ArrayBuffer(0), done: true } });
  const close = await s.next(message => message.method === "services.network.closeStream");
  expect(data(close.args!)).toEqual(["response-id"]);
  s.worker.postMessage({ t: "result", id: close.id, ok: true, value: null });
  expect(resultData(await s.next(message => message.t === "result" && message.id === 900))).toMatchObject({ ok: true, value: { toast: "200: 3 bytes" } });
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

test("real Worker preserves network classification including a locally expired signal", async () => {
  const pre = await command("pre-timeout");
  expect(resultData(await pre.next(message => message.t === "result" && message.id === 900)))
    .toMatchObject({ ok: true, value: { toast: "plugin/network-timeout" } });
  expect(pre.messages.some(message => message.method === "services.network.fetch")).toBe(false);
  const live = await command("live-timeout");
  const call = await live.next(message => message.method === "services.network.fetch");
  expect(await live.next(message => message.t === "cancel")).toMatchObject({ id: call.id });
  expect(resultData(await live.next(message => message.t === "result" && message.id === 900)))
    .toMatchObject({ ok: true, value: { toast: "plugin/network-timeout" } });
  const failed = await command("network-failure");
  const request = await failed.next(message => message.method === "services.network.fetch");
  failed.worker.postMessage({ t: "result", id: request.id, ok: false, error: "Private native transport rejection" });
  expect(resultData(await failed.next(message => message.t === "result" && message.id === 900)))
    .toMatchObject({ ok: true, value: { toast: "plugin/network-failed" } });
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

test("real Worker action handles update before and after acknowledgement and retire across disposal races", async () => {
  const s = sandbox("action-state", "action-state-wire-probe.ts");
  const main = await s.next(message => message.method === "contributions.commands.register");
  const handle = (data(main.args!) as { run: () => string }[])[0].run();
  s.worker.postMessage({ t: "result", id: main.id, ok: true, value: null, disposable: "main" });
  await s.next(message => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "active" } });
  s.worker.postMessage({ t: "invoke", id: 920, handle, args: [] });
  const child = await s.next(message => message.method === "contributions.commands.register");
  s.worker.postMessage({ t: "health", id: 921 });
  await s.next(message => message.t === "healthy" && message.id === 921);
  expect(s.messages.some(message => message.method === "$registration.updateState")).toBe(false);
  s.worker.postMessage({ t: "result", id: child.id, ok: true, value: null, disposable: "child" });
  const first = await s.next(message => message.method === "$registration.updateState");
  expect(data(first.args!)).toEqual(["child", { revision: 1, enabled: false, visible: true, checked: true }]);
  s.worker.postMessage({ t: "result", id: first.id, ok: true, value: { status: "applied" } });
  const second = await s.next(message => message.method === "$registration.updateState");
  expect(data(second.args!)).toEqual(["child", { revision: 2, enabled: true, visible: false }]);
  s.worker.postMessage({ t: "result", id: second.id, ok: true, value: { status: "applied" } });
  expect(await s.next(message => message.t === "dispose")).toMatchObject({ handle: "child" });
  const temporary = await s.next(message => message.method === "contributions.commands.register");
  s.worker.postMessage({ t: "result", id: temporary.id, ok: true, value: null, disposable: "temporary" });
  expect(await s.next(message => message.t === "dispose")).toMatchObject({ handle: "temporary" });
  const result = resultData(await s.next(message => message.t === "result" && message.id === 920));
  expect(result).toMatchObject({ ok: true, value: { toast: JSON.stringify({ first: { status: "applied" },
    second: { status: "applied" }, retired: { status: "inactive" }, disposedBeforeAck: { status: "inactive" } }) } });
  expect(s.messages.some(message => message.method === "$registration.updateState")).toBe(false);
});
