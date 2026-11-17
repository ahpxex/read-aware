import { afterEach, expect, test } from "bun:test";
import { decodePluginCallbacks, type PluginCallbackWire } from "./plugin-callback-wire";

type Message = {
  t: string;
  id?: number;
  method?: string;
  args?: PluginCallbackWire;
  value?: PluginCallbackWire;
  ok?: boolean;
  error?: string;
};
const data = (wire: PluginCallbackWire) => decodePluginCallbacks(wire, (handle) => handle);
const resultData = (message: Message) => ({ ...message, value: message.value && data(message.value) });
const workers: Worker[] = [];
afterEach(() => {
  for (const worker of workers.splice(0)) worker.terminate();
});

function sandbox(scenario: string, fixture = "wire-probe.ts", bootPatch: Record<string, unknown> = {}) {
  const worker = new Worker(new URL("./plugin-sandbox.worker.ts", import.meta.url), { type: "module" });
  workers.push(worker);
  const messages: Message[] = [];
  const listeners = new Set<() => void>();
  worker.onmessage = (event) => {
    messages.push(event.data);
    for (const listener of [...listeners]) listener();
  };
  const next = (predicate: (message: Message) => boolean): Promise<Message> =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        listeners.delete(check);
        reject(new Error(`No matching sandbox message: ${JSON.stringify(messages)}`));
      }, 3000);
      const check = () => {
        const failed = messages.find((message) => message.t === "failed");
        if (failed && !predicate(failed)) {
          clearTimeout(timeout);
          listeners.delete(check);
          reject(new Error(failed.error));
          return;
        }
        const index = messages.findIndex(predicate);
        if (index < 0) return;
        clearTimeout(timeout);
        listeners.delete(check);
        resolve(messages.splice(index, 1)[0]);
      };
      listeners.add(check);
      check();
    });
  worker.postMessage({
    t: "boot",
    protocolVersion: 1,
    url: new URL(`../../../../tests/fixtures/plugin-workers/${fixture}`, import.meta.url).href,
    manifest: {
      id: "wire-test",
      name: "Wire test",
      description: scenario,
      version: "1.0.0",
      schemaVersion: 1,
      requires: {},
    },
    appVersion: "1.0.0",
    capabilities: { domains: {}, services: {}, contributions: {}, schemas: {} },
    grants: { book: { mode: "all" } },
    locale: "en",
    phase: "activating",
    storage: {},
    shape: {
      domains: { library: { queries: { books: { searchLocations: "fn" } } }, reading: { commands: { step: "fn" } } },
      services: {
        llm: { ask: "fn", askDetailed: "fn", policy: "fn", getRequest: "fn", listRequests: "fn", cancelRequest: "fn" },
        logging: { write: "fn", policy: "fn" },
        network: { fetch: "fn", openStream: "fn", readStream: "fn", closeStream: "fn" },
      },
      contributions: { commands: { register: "fn" }, agentContextProviders: { register: "fn" } },
      __collection: { put: "fn", get: "fn", page: "fn" },
    },
    ...bootPatch,
  });
  return { worker, messages, next };
}

async function command(scenario: string, fixture?: string) {
  const s = sandbox(scenario, fixture);
  const registration = await s.next((message) => message.method === "contributions.commands.register");
  const handle = (data(registration.args!) as { run: () => string }[])[0].run();
  s.worker.postMessage({ t: "result", id: registration.id, ok: true, value: null, disposable: "registration" });
  await s.next((message) => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "active" } });
  s.worker.postMessage({ t: "invoke", id: 900, handle, args: [] });
  return s;
}

test("real Worker queries operation prerequisites with cancellable call options", async () => {
  for (const scenario of ["read", "cancel", "reading", "text", "text-cancel"]) {
    const s = sandbox(scenario, "operation-availability-probe.ts", {
      shape: {
        services: { session: { operationAvailability: "fn" } },
        contributions: { commands: { register: "fn" } },
      },
    });
    const registration = await s.next((message) => message.method === "contributions.commands.register");
    const handle = (data(registration.args!) as { run: () => string }[])[0]!.run();
    s.worker.postMessage({ t: "result", id: registration.id, ok: true, value: null, disposable: "registration" });
    await s.next((message) => message.t === "ready");
    s.worker.postMessage({ t: "sync", patch: { phase: "active" } });
    s.worker.postMessage({ t: "invoke", id: 901, handle, args: [] });
    const query = await s.next((message) => message.method === "services.session.operationAvailability");
    expect(data(query.args!)).toEqual([
      scenario === "reading"
        ? { operation: "reading.playback", bookId: "book", sessionId: "session", action: "start" }
        : scenario.startsWith("text")
          ? {
              operation: "library.text.prepare",
              bookId: "book",
              rebuild: true,
              priority: "background",
              timeoutMs: 2000,
            }
          : { operation: "llm.infer", model: "smart", images: true },
      undefined,
    ]);
    if (scenario.includes("cancel")) {
      await s.next((message) => message.t === "cancel" && message.id === query.id);
    } else
      s.worker.postMessage({
        t: "result",
        id: query.id,
        ok: true,
        value: {
          operation:
            scenario === "reading" ? "reading.playback" : scenario === "text" ? "library.text.prepare" : "llm.infer",
          state: "unknown",
          remoteChecked: false,
          conditions: [{ kind: "provider", state: "unknown", reason: "remote-health-not-checked" }],
        },
      });
    const result = resultData(await s.next((message) => message.t === "result" && message.id === 901));
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.value)).toContain(
      scenario.includes("cancel") ? "plugin/cancelled" : "remote-health-not-checked",
    );
  }
});

test("real Worker preserves and snapshots explicit safe retry options across request flattening", async () => {
  const s = await command("network-retry", "network-retry-probe.ts");
  const call = await s.next((message) => message.method === "services.network.fetch");
  expect((data(call.args!) as unknown[])[2]).toEqual({ retry: "safe" });
  s.worker.postMessage({
    t: "result",
    id: call.id,
    ok: true,
    value: {
      status: 200,
      statusText: "OK",
      url: "https://a.test/retry",
      headers: [],
      body: new TextEncoder().encode("retried").buffer,
    },
  });
  expect(resultData(await s.next((message) => message.t === "result" && message.id === 900))).toMatchObject({
    ok: true,
    value: { toast: "retried" },
  });
});

test("real Worker binds an existing contribution handle and awaits source-aware retirement acknowledgement", async () => {
  const s = sandbox("contribution-observation-reaction", "event-reaction-probe.ts", {
    shape: {
      domains: {},
      services: { plugins: { observeContributions: "fn" } },
      contributions: { commands: { register: "fn" } },
    },
  });
  const command = await s.next((message) => message.method === "contributions.commands.register");
  const subscription = await s.next((message) => message.method === "services.plugins.observeContributions");
  const callback = (data(subscription.args!) as [object, () => string])[1]();
  s.worker.postMessage({ t: "result", id: command.id, ok: true, value: null, disposable: "command" });
  s.worker.postMessage({ t: "result", id: subscription.id, ok: true, value: null, disposable: "observer" });
  await s.next((message) => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "active" } });
  const reaction = { id: "contribution-lease", status: "ready" };
  s.worker.postMessage({
    t: "invoke",
    id: 940,
    handle: callback,
    args: [{ contributions: [], total: 0, offset: 0, nextOffset: null }, { reaction }],
  });
  const update = await s.next((message) => message.method === "$registration.updateState");
  expect((update as unknown as { reaction: unknown }).reaction).toEqual(reaction);
  expect(data(update.args!)).toEqual(["command", { revision: 1, visible: true, enabled: false }]);
  s.worker.postMessage({ t: "result", id: update.id, ok: true, value: { status: "applied" } });
  const retirement = await s.next((message) => message.method === "$registration.dispose");
  expect((retirement as unknown as { reaction: unknown }).reaction).toEqual(reaction);
  expect(data(retirement.args!)).toEqual(["command"]);
  expect(s.messages.some((message) => message.t === "result" && message.id === 940)).toBe(false);
  expect(s.messages.some((message) => message.method === "services.storage.set")).toBe(false);
  s.worker.postMessage({ t: "result", id: retirement.id, ok: true, value: null });
  const independent = await s.next((message) => message.method === "services.storage.set");
  expect((independent as unknown as { reaction?: unknown }).reaction).toBeUndefined();
  s.worker.postMessage({ t: "result", id: independent.id, ok: true, value: null });
  expect(await s.next((message) => message.t === "result" && message.id === 940)).toMatchObject({ ok: true });
  // Host-side lease rejection must reach the callback rather than becoming a
  // fire-and-forget disposal message or an apparent success.
  s.worker.postMessage({
    t: "invoke",
    id: 941,
    handle: callback,
    args: [{ contributions: [], total: 0, offset: 0, nextOffset: null }, { reaction }],
  });
  const expired = await s.next((message) => message.method === "$registration.updateState");
  s.worker.postMessage({
    t: "result",
    id: expired.id,
    ok: false,
    code: "plugin/invalid-cause",
    error: "Expired contribution reaction",
  });
  expect(await s.next((message) => message.t === "result" && message.id === 941)).toMatchObject({ ok: false });
});

test("real Worker event context keeps its opaque lease across await, nested namespaces and storage overrides", async () => {
  const s = sandbox("event-reaction", "event-reaction-probe.ts", {
    shape: {
      domains: { library: { events: { subscribe: "fn" } }, reading: { commands: { step: "fn" } } },
      services: {},
      contributions: {},
      __collection: { get: "fn" },
    },
  });
  const registration = await s.next((message) => message.method === "domains.library.events.subscribe");
  const handle = (data(registration.args!) as [string, () => string])[1]();
  s.worker.postMessage({
    t: "result",
    id: registration.id,
    ok: true,
    value: null,
    disposable: "reaction-subscription",
  });
  await s.next((message) => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "active" } });
  const reaction = { id: "issued-by-host", status: "ready" };
  s.worker.postMessage({
    t: "invoke",
    id: 935,
    handle,
    args: [{ type: "book.starred", origin: "user", payload: { bookId: "b", starred: true }, reaction }],
  });
  for (const method of [
    "domains.reading.commands.step",
    "services.storage.set",
    "services.storage.collection(reactions).get",
    "services.storage.getDurable",
  ]) {
    const call = await s.next((message) => message.method === method);
    expect((call as unknown as { reaction?: unknown }).reaction).toEqual(
      method === "services.storage.getDurable" ? undefined : reaction,
    );
    s.worker.postMessage({ t: "result", id: call.id, ok: true, value: null });
  }
  expect(await s.next((message) => message.t === "result" && message.id === 935)).toMatchObject({ ok: true });
});

test("real Worker receives observation causality separately from the unchanged snapshot", async () => {
  const s = sandbox("observation-reaction", "event-reaction-probe.ts", {
    shape: { domains: { settings: { queries: { observe: "fn" } } }, services: {}, contributions: {} },
  });
  const registration = await s.next((message) => message.method === "domains.settings.queries.observe");
  const handle = (data(registration.args!) as [object, () => string])[1]();
  s.worker.postMessage({
    t: "result",
    id: registration.id,
    ok: true,
    value: null,
    disposable: "observation-subscription",
  });
  await s.next((message) => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "active" } });
  const reaction = { id: "observation-lease", status: "ready" };
  s.worker.postMessage({
    t: "invoke",
    id: 936,
    handle,
    args: [
      {
        status: "ready",
        source: "local",
        origin: "user",
        snapshot: { revision: 7, target: { kind: "global" }, settings: [], overrides: [] },
      },
      { reaction },
    ],
  });
  const call = await s.next((message) => message.method === "services.storage.set");
  expect((call as unknown as { reaction: unknown }).reaction).toEqual(reaction);
  expect(data(call.args!)).toEqual(["observed", 7]);
  s.worker.postMessage({ t: "result", id: call.id, ok: true, value: null });
  expect(await s.next((message) => message.t === "result" && message.id === 936)).toMatchObject({ ok: true });
});

test("real Worker annotation observations bind conditional edits across await without changing the snapshot", async () => {
  const s = sandbox("annotation-observation-reaction", "event-reaction-probe.ts", {
    shape: {
      domains: { annotations: { events: { observe: "fn" }, commands: { applyChanges: "fn" } } },
      services: {},
      contributions: {},
    },
  });
  const registration = await s.next((message) => message.method === "domains.annotations.events.observe");
  const args = data(registration.args!) as [object, () => string];
  expect(args[0]).toEqual({ kind: "page", query: { bookId: "b" } });
  const handle = args[1]();
  s.worker.postMessage({
    t: "result",
    id: registration.id,
    ok: true,
    value: null,
    disposable: "annotation-subscription",
  });
  await s.next((message) => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "active" } });
  const reaction = { id: "annotation-lease", status: "ready" };
  s.worker.postMessage({
    t: "invoke",
    id: 937,
    handle,
    args: [
      {
        status: "ready",
        revision: 1,
        result: { kind: "page", page: { items: [], nextCursor: null, consistency: "live" } },
      },
      { reaction },
    ],
  });
  const call = await s.next((message) => message.method === "domains.annotations.commands.applyChanges");
  expect((call as unknown as { reaction: unknown }).reaction).toEqual(reaction);
  expect(data(call.args!)).toEqual([
    [{ op: "updateNote", annotationId: "n", expectedRevision: `ann1:${"a".repeat(64)}`, body: "changed" }],
  ]);
  s.worker.postMessage({ t: "result", id: call.id, ok: true, value: { atomic: true, changes: [] } });
  expect(await s.next((message) => message.t === "result" && message.id === 937)).toMatchObject({ ok: true });
});

test("real Worker nullable image observations retain the host lease through a panel command", async () => {
  const s = sandbox("nullable-observation-reaction", "event-reaction-probe.ts", {
    shape: {
      domains: {},
      services: { ui: { reader: { image: { observe: "fn" }, setPanel: "fn" } } },
      contributions: {},
    },
  });
  const registration = await s.next((message) => message.method === "services.ui.reader.image.observe");
  const args = data(registration.args!) as [() => string],
    handle = args[0]();
  s.worker.postMessage({ t: "result", id: registration.id, ok: true, value: null, disposable: "image-subscription" });
  await s.next((message) => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "active" } });
  const reaction = { id: "image-lease", status: "ready" };
  s.worker.postMessage({ t: "invoke", id: 939, handle, args: [null, { reaction }] });
  const call = await s.next((message) => message.method === "services.ui.reader.setPanel");
  expect((call as unknown as { reaction: unknown }).reaction).toEqual(reaction);
  expect(data(call.args!)).toEqual(["chat", false]);
  s.worker.postMessage({
    t: "result",
    id: call.id,
    ok: true,
    value: { status: "completed", panel: "chat", snapshot: {} },
  });
  expect(await s.next((message) => message.t === "result" && message.id === 939)).toMatchObject({ ok: true });
});

test("real Worker memory observations retain the host lease through conditional mutation", async () => {
  const s = sandbox("memory-observation-reaction", "event-reaction-probe.ts", {
    shape: {
      domains: { memory: { events: { observe: "fn" }, commands: { mutate: "fn" } } },
      services: {},
      contributions: {},
    },
  });
  const registration = await s.next((message) => message.method === "domains.memory.events.observe");
  const args = data(registration.args!) as [object, () => string];
  expect(args[0]).toEqual({ kind: "inspect", memoryId: "m" });
  const handle = args[1]();
  s.worker.postMessage({ t: "result", id: registration.id, ok: true, value: null, disposable: "memory-subscription" });
  await s.next((message) => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "active" } });
  const reaction = { id: "memory-lease", status: "ready" };
  s.worker.postMessage({
    t: "invoke",
    id: 938,
    handle,
    args: [{ status: "ready", revision: 1, result: { kind: "inspect", snapshot: null } }, { reaction }],
  });
  const call = await s.next((message) => message.method === "domains.memory.commands.mutate");
  expect((call as unknown as { reaction: unknown }).reaction).toEqual(reaction);
  expect(data(call.args!)).toEqual([
    { op: "correct", memoryId: "m", expectedRevision: `mem1:${"a".repeat(64)}`, content: "changed" },
  ]);
  s.worker.postMessage({ t: "result", id: call.id, ok: true, value: { memoryId: "m", revision: "next" } });
  expect(await s.next((message) => message.t === "result" && message.id === 938)).toMatchObject({ ok: true });
});

test.each([undefined, 0, 2, "1"])(
  "real Worker rejects incompatible boot version %s before loading plugin code",
  async (protocolVersion) => {
    const s = sandbox("must-not-activate", "wire-probe.ts", { protocolVersion });
    expect(await s.next((message) => message.t === "failed")).toMatchObject({
      error: "Host protocol or transport version rejected",
    });
    expect(s.messages.some((message) => message.t === "call" || message.t === "hello" || message.t === "ready")).toBe(
      false,
    );
  },
);

test("real Worker receives a frozen explicit book grant and cannot widen it", async () => {
  const s = sandbox("grant-metadata", "wire-probe.ts", { grants: { book: { mode: "book", bookId: "book-a" } } });
  const registration = await s.next((message) => message.method === "contributions.commands.register");
  const handle = (data(registration.args!) as { run: () => string }[])[0]!.run();
  s.worker.postMessage({ t: "result", id: registration.id, ok: true, value: null, disposable: "grant-registration" });
  await s.next((message) => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "active" } });
  s.worker.postMessage({ t: "invoke", id: 909, handle, args: [] });
  const result = resultData(await s.next((message) => message.t === "result" && message.id === 909));
  expect(result).toMatchObject({
    ok: true,
    value: { toast: '{"book":{"mode":"book","bookId":"book-a"}}|{"book":{"mode":"book","bookId":"book-a"}}' },
  });
});

test("real Worker rejects malformed host invocations and results without losing the next call", async () => {
  const s = sandbox("durable-storage");
  expect(await s.next((message) => message.t === "hello")).toMatchObject({ protocolVersion: 1 });
  const registration = await s.next((message) => message.method === "contributions.commands.register");
  const handle = (data(registration.args!) as { run: () => string }[])[0]!.run();
  s.worker.postMessage({ t: "result", id: registration.id, ok: true, value: null, disposable: "d1" });
  await s.next((message) => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "active" } });
  s.worker.postMessage({ t: "invoke", id: 910, handle, args: new Array(1_000_001) });
  expect(await s.next((message) => message.t === "result" && message.id === 910)).toMatchObject({
    ok: false,
    code: "plugin/quota-exceeded",
  });
  expect(s.messages.some((message) => message.method === "services.storage.getDurable")).toBe(false);
  s.worker.postMessage({ t: "invoke", id: 911, handle, args: [] });
  const call = await s.next((message) => message.method === "services.storage.getDurable");
  s.worker.postMessage({ t: "result", id: call.id, ok: true, value: new Array(1_000_001), disposable: "d2" });
  expect(await s.next((message) => message.t === "dispose")).toMatchObject({ handle: "d2" });
  expect(await s.next((message) => message.t === "result" && message.id === 911)).toMatchObject({
    ok: false,
    code: "plugin/quota-exceeded",
  });
  s.worker.postMessage({ t: "invoke", id: 912, handle, args: [] });
  const retry = await s.next((message) => message.method === "services.storage.getDurable");
  s.worker.postMessage({ t: "result", id: retry.id, ok: true, value: "recovered" });
  expect(resultData(await s.next((message) => message.t === "result" && message.id === 912))).toMatchObject({
    ok: true,
    value: { toast: "recovered" },
  });
});

test.each(["sync", "boot"])(
  "real Worker fails closed on an invalid %s rather than serving a stale mirror or reactivating",
  async (kind) => {
    const s = await command("durable-storage");
    const call = await s.next((message) => message.method === "services.storage.getDurable");
    s.worker.postMessage(
      kind === "sync" ? { t: "sync", patch: { storage: { x: false } } } : { t: "boot", protocolVersion: 1 },
    );
    await s.next((message) => message.t === "failed");
    expect(s.messages.some((message) => message.t === "ready")).toBe(false);
    expect(call.id).toBeGreaterThan(0);
  },
);

test("real Worker rejects oversized results before transport and remains callable with bounded errors", async () => {
  const s = sandbox("wire-budget", "wire-budget-probe.ts");
  const registration = await s.next((message) => message.method === "contributions.commands.register");
  const handle = (data(registration.args!) as { run: () => string }[])[0]!.run();
  s.worker.postMessage({ t: "result", id: registration.id, ok: true, value: null, disposable: "d1" });
  await s.next((message) => message.t === "ready");
  for (const id of [901, 902, 903]) {
    s.worker.postMessage({ t: "invoke", id, handle, args: [] });
    const result = await s.next((message) => message.t === "result" && message.id === id);
    if (id === 901) expect(result).toMatchObject({ ok: false, code: "plugin/quota-exceeded" });
    if (id === 902) expect(resultData(result)).toMatchObject({ ok: true, value: { toast: "recovered" } });
    if (id === 903) {
      expect(result.ok).toBe(false);
      expect(result.error).toHaveLength(4096);
    }
  }
});

test("Worker durable KV bypasses its mirror and nested reading-intent source callbacks use real RPC", async () => {
  const durable = await command("durable-storage");
  const call = await durable.next((message) => message.method === "services.storage.getDurable");
  expect(data(call.args!)).toEqual(["result"]);
  durable.worker.postMessage({ t: "sync", patch: { storage: { result: '"stale mirror"' } } });
  durable.worker.postMessage({ t: "result", id: call.id, ok: true, value: "durable value" });
  expect(resultData(await durable.next((message) => message.t === "result" && message.id === 900))).toMatchObject({
    value: { toast: "durable value" },
  });
  const s = sandbox("intention-source"),
    registration = await s.next((message) => message.method === "contributions.agentContextProviders.register");
  const source = (data(registration.args!) as { readingIntent: { prepare: () => string; read: () => string } }[])[0]!
    .readingIntent;
  s.worker.postMessage({ t: "result", id: registration.id, ok: true, value: null, disposable: "provider" });
  const cmd = await s.next((message) => message.method === "contributions.commands.register");
  s.worker.postMessage({ t: "result", id: cmd.id, ok: true, value: null, disposable: "command" });
  await s.next((message) => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "active" } });
  const doc = {
    id: "one",
    bookId: "one",
    revision: "doc:1",
    data: { version: 1, goal: { text: "Stored goal", suggestMemory: false } },
    updatedAt: "now",
  };
  for (const [id, handle] of [
    [901, source.prepare()],
    [902, source.read()],
  ] as const) {
    s.worker.postMessage({ t: "invoke", id, handle, args: [{ kind: "book", id: "one" }] });
    const get = await s.next((message) => message.method === "services.storage.collection(goals).get");
    expect(data(get.args!)).toEqual(["one"]);
    s.worker.postMessage({ t: "result", id: get.id, ok: true, value: doc });
    if (id === 901) {
      const legacy = await s.next((message) => message.method === "services.storage.getDurable");
      expect(data(legacy.args!)).toEqual(["goal:one"]);
      s.worker.postMessage({ t: "result", id: legacy.id, ok: true, value: null });
      const flush = await s.next((message) => message.method === "services.storage.flush");
      s.worker.postMessage({ t: "result", id: flush.id, ok: true, value: null });
    }
    const result = resultData(await s.next((message) => message.t === "result" && message.id === id));
    expect(result.ok).toBe(true);
    if (id === 902) expect(result.value).toEqual({ revision: "doc:1", text: "Stored goal" });
  }
});

test.each(["query", "navigation"])(
  "Worker %s cancellation strips options, preserves guards and drops late results",
  async (kind) => {
    const method = kind === "query" ? "domains.library.queries.books.searchLocations" : "domains.reading.commands.step";
    const pre = await command(`${kind}-pre`, "operation-cancel-probe.ts");
    expect(resultData(await pre.next((message) => message.t === "result" && message.id === 900))).toMatchObject({
      ok: true,
      value: { toast: "replaced" },
    });
    expect(pre.messages.some((message) => message.method === method)).toBe(false);
    const live = await command(`${kind}-live`, "operation-cancel-probe.ts");
    const call = await live.next((message) => message.method === method);
    expect(data(call.args!)).toEqual(
      kind === "query" ? [{ bookId: "b", query: "q" }, undefined] : ["next", { sessionId: "active" }, undefined],
    );
    expect(await live.next((message) => message.t === "cancel")).toMatchObject({ id: call.id });
    expect(resultData(await live.next((message) => message.t === "result" && message.id === 900))).toMatchObject({
      ok: true,
      value: { toast: "replaced" },
    });
    live.worker.postMessage({ t: "result", id: call.id, ok: true, value: { late: true } });
    live.worker.postMessage({ t: "health", id: 993 });
    await live.next((message) => message.t === "healthy");
    expect(live.messages.some((message) => message.t === "result" && message.id === 900)).toBe(false);
  },
);

test.each(["ask", "askDetailed"])(
  "Worker LLM %s cancellation keeps AbortSignal local and cancels only its outstanding request",
  async (method) => {
    const suffix = method === "askDetailed" ? "-detailed" : "";
    const pre = await command(`pre-abort${suffix}`, "llm-probe.ts");
    expect(resultData(await pre.next((message) => message.t === "result" && message.id === 900))).toMatchObject({
      ok: true,
      value: { toast: "stopped" },
    });
    expect(pre.messages.some((message) => message.method === `services.llm.${method}`)).toBe(false);
    const live = await command(`live-abort${suffix}`, "llm-probe.ts");
    const call = await live.next((message) => message.method === `services.llm.${method}`);
    expect(data(call.args!)).toEqual([{ prompt: "probe", timeoutMs: 5000 }]);
    expect(await live.next((message) => message.t === "cancel")).toMatchObject({ id: call.id });
    expect(resultData(await live.next((message) => message.t === "result" && message.id === 900))).toMatchObject({
      ok: true,
      value: { toast: "stopped" },
    });
    live.worker.postMessage({ t: "result", id: call.id, ok: true, value: "late private output" });
    live.worker.postMessage({ t: "health", id: 992 });
    await live.next((message) => message.t === "healthy");
    expect(live.messages.some((message) => message.t === "result" && message.id === 900)).toBe(false);
  },
);

test("Worker detailed inference carries a plain output cap and receives the metadata envelope", async () => {
  const s = await command("detailed", "llm-probe.ts");
  const call = await s.next((message) => message.method === "services.llm.askDetailed");
  expect(data(call.args!)).toEqual([
    { prompt: "probe", maxOutputTokens: 128, maxTotalOutputTokens: 180, maxOutputChars: 1000 },
  ]);
  s.worker.postMessage({
    t: "result",
    id: call.id,
    ok: true,
    value: { value: "ok", attempts: [{ usage: null, estimatedCostUsd: null }] },
  });
  expect(resultData(await s.next((message) => message.t === "result" && message.id === 900))).toMatchObject({
    ok: true,
    value: { toast: "ok:1" },
  });
});

test("Worker cancelled inference can independently retrieve its named request receipt", async () => {
  const s = await command("receipt", "llm-probe.ts");
  const call = await s.next((message) => message.method === "services.llm.ask");
  expect(data(call.args!)).toEqual([{ prompt: "probe", requestId: "probe-request" }]);
  expect(await s.next((message) => message.t === "cancel")).toMatchObject({ id: call.id });
  const query = await s.next((message) => message.method === "services.llm.getRequest");
  expect(data(query.args!)).toEqual(["probe-request"]);
  s.worker.postMessage({
    t: "result",
    id: query.id,
    ok: true,
    value: { requestId: "probe-request", status: "cancelled", settled: false },
  });
  expect(resultData(await s.next((message) => message.t === "result" && message.id === 900))).toMatchObject({
    ok: true,
    value: { toast: "cancelled:false" },
  });
});

test("Worker logging crosses normal and restricted migration contexts with structured receipts", async () => {
  const s = sandbox("logging", "logging-probe.ts");
  const activation = await s.next((message) => message.method === "services.logging.write");
  expect(data(activation.args!)).toEqual([{ level: "info", event: "activation.started", fields: { attempt: 1 } }]);
  s.worker.postMessage({ t: "result", id: activation.id, ok: true, value: { status: "accepted" } });
  await s.next((message) => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "migrating" } });
  s.worker.postMessage({ t: "migrate", id: 990, migration: { fromVersion: 1, toVersion: 2, direction: "upgrade" } });
  const migration = await s.next((message) => message.method === "services.logging.write");
  expect(data(migration.args!)).toEqual([{ level: "warn", event: "migration.failed", errorCode: "db/locked" }]);
  s.worker.postMessage({
    t: "result",
    id: migration.id,
    ok: true,
    value: { status: "rate-limited", retryAfterMs: 1000 },
  });
  expect(await s.next((message) => message.t === "migrated")).toMatchObject({ id: 990, ok: true });
});

test("Worker storage override retains document pages and conditional transactions", async () => {
  const s = await command("documents", "document-probe.ts");
  const page = await s.next((message) => message.method === "services.storage.collection(words).page");
  expect(data(page.args!)).toEqual([{ limit: 1, query: "École 中文" }]);
  s.worker.postMessage({
    t: "result",
    id: page.id,
    ok: true,
    value: { status: "ready", items: [{ id: "word", revision: "a".repeat(32), data: {} }], nextCursor: null },
  });
  const apply = await s.next((message) => message.method === "services.storage.applyDocuments");
  expect(data(apply.args!)).toEqual([
    [{ kind: "check", collection: "words", id: "word", expectedRevision: "a".repeat(32) }],
  ]);
  s.worker.postMessage({ t: "result", id: apply.id, ok: true, value: { status: "conflict", index: 0 } });
  expect(resultData(await s.next((message) => message.t === "result" && message.id === 900))).toMatchObject({
    ok: true,
    value: { toast: "conflict" },
  });
});

test("Worker migration storage exposes conditional document commits and waits for acknowledgement", async () => {
  const s = sandbox("documents", "document-probe.ts");
  const registration = await s.next((message) => message.method === "contributions.commands.register");
  s.worker.postMessage({ t: "result", id: registration.id, ok: true, value: null, disposable: "registration" });
  await s.next((message) => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "migrating" } });
  s.worker.postMessage({ t: "migrate", id: 903, migration: { fromVersion: 1, toVersion: 2, direction: "upgrade" } });
  const write = await s.next((message) => message.method === "services.storage.applyDocuments");
  expect(data(write.args!)).toEqual([
    [{ kind: "put", collection: "words", id: "seed", data: {}, expectedRevision: null }],
  ]);
  s.worker.postMessage({ t: "health", id: 904 });
  await s.next((message) => message.t === "healthy");
  expect(s.messages.some((message) => message.t === "migrated")).toBe(false);
  s.worker.postMessage({ t: "result", id: write.id, ok: true, value: { status: "applied", documents: [] } });
  expect(await s.next((message) => message.t === "migrated")).toMatchObject({ id: 903, ok: true });
});

test("Worker private document observations carry callbacks and dispose the host registration", async () => {
  const s = await command("observe-documents", "document-probe.ts");
  const observation = await s.next((message) => message.method === "services.storage.observeDocuments");
  const [query, callback] = data(observation.args!) as [unknown, () => string];
  expect(query).toEqual({ kind: "get", collection: "words", id: "word" });
  s.worker.postMessage({ t: "result", id: observation.id, ok: true, value: null, disposable: "observer" });
  s.worker.postMessage({
    t: "invoke",
    id: 901,
    handle: callback(),
    args: [{ sequence: 1, status: "ready", result: { kind: "get", document: null } }],
  });
  expect(resultData(await s.next((message) => message.t === "result" && message.id === 900))).toMatchObject({
    ok: true,
    value: { toast: "ready:1" },
  });
  expect(await s.next((message) => message.t === "dispose")).toMatchObject({ handle: "observer" });
});

test("real Worker preserves Request semantics, binary responses and authoritative storage acknowledgements", async () => {
  const s = await command("request-storage");
  const fetch = await s.next((message) => message.method === "services.network.fetch");
  const [url, init] = data(fetch.args!) as [string, RequestInit];
  expect(url).toBe("https://example.test/file");
  expect(init.method).toBe("PUT");
  expect(new Headers(init.headers).get("x-token")).toBe("test");
  expect([...new Uint8Array(init.body as ArrayBuffer)]).toEqual([0, 255]);
  s.worker.postMessage({
    t: "result",
    id: fetch.id,
    ok: true,
    value: { status: 200, statusText: "OK", url, headers: [], body: new TextEncoder().encode("stored").buffer },
  });
  const write = await s.next((message) => message.method === "services.storage.set");
  s.worker.postMessage({ t: "health", id: 901 });
  await s.next((message) => message.t === "healthy");
  expect(s.messages.some((message) => message.t === "result" && message.id === 900)).toBe(false);
  s.worker.postMessage({ t: "sync", patch: { storage: { result: '"stored"' } } });
  s.worker.postMessage({ t: "result", id: write.id, ok: true, value: null });
  expect(resultData(await s.next((message) => message.t === "result" && message.id === 900))).toMatchObject({
    ok: true,
    value: { toast: "stored" },
  });
});

test("real Worker opens a Request stream then pulls binary chunks and closes its handle", async () => {
  const s = await command("stream");
  const open = await s.next((message) => message.method === "services.network.openStream");
  const [url, init] = data(open.args!) as [string, RequestInit];
  expect(url).toBe("https://example.test/file");
  expect(init.method).toBe("PUT");
  expect(new Headers(init.headers).get("x-token")).toBe("stream");
  expect([...new Uint8Array(init.body as ArrayBuffer)]).toEqual([0, 255]);
  s.worker.postMessage({
    t: "result",
    id: open.id,
    ok: true,
    value: {
      id: "response-id",
      url,
      status: 200,
      statusText: "OK",
      headers: [],
      redirected: false,
      expiresAt: Date.now() + 120000,
    },
  });
  const first = await s.next((message) => message.method === "services.network.readStream");
  expect(data(first.args!)).toEqual(["response-id", 0, 1024]);
  s.worker.postMessage({
    t: "result",
    id: first.id,
    ok: true,
    value: { offset: 0, bytes: new Uint8Array([0, 255, 3]).buffer, done: false },
  });
  const second = await s.next((message) => message.method === "services.network.readStream");
  expect(data(second.args!)).toEqual(["response-id", 3, 1024]);
  s.worker.postMessage({
    t: "result",
    id: second.id,
    ok: true,
    value: { offset: 3, bytes: new ArrayBuffer(0), done: true },
  });
  const close = await s.next((message) => message.method === "services.network.closeStream");
  expect(data(close.args!)).toEqual(["response-id"]);
  s.worker.postMessage({ t: "result", id: close.id, ok: true, value: null });
  expect(resultData(await s.next((message) => message.t === "result" && message.id === 900))).toMatchObject({
    ok: true,
    value: { toast: "200: 3 bytes" },
  });
});

test("real Worker transports marker data, awaitable disposables and explicit callback release", async () => {
  const s = sandbox("callbacks", "callback-probe.ts");
  const main = await s.next((message) => message.method === "contributions.commands.register");
  const mainHandle = (data(main.args!) as { run: () => string }[])[0].run();
  s.worker.postMessage({ t: "result", id: main.id, ok: true, value: null, disposable: "main" });
  await s.next((message) => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "active" } });
  s.worker.postMessage({ t: "invoke", id: 910, handle: mainHandle, args: [] });
  const temporary = await s.next((message) => message.method === "contributions.commands.register");
  const temporaryHandle = (data(temporary.args!) as { run: () => string }[])[0].run();
  s.worker.postMessage({ t: "result", id: temporary.id, ok: true, value: null, disposable: "temporary" });
  const put = await s.next((message) => message.method?.endsWith(".put") === true);
  const marker = (data(put.args!) as unknown[])[1];
  expect(marker).toMatchObject({ __fn: "h1", __disposable: "d1", nested: [{ __fn: "h2", ordinary: true }] });
  expect(put.args!.callbacks).toHaveLength(0);
  s.worker.postMessage({ t: "result", id: put.id, ok: true, value: null });
  const get = await s.next((message) => message.method?.endsWith(".get") === true);
  s.worker.postMessage({ t: "result", id: get.id, ok: true, value: { data: marker } });
  const view = await s.next((message) => message.t === "result" && message.id === 910);
  const result = data(view.value!) as { view: { actions: { run: () => string }[] } };
  s.worker.postMessage({ t: "invoke", id: 911, handle: result.view.actions[0].run(), args: [] });
  expect(await s.next((message) => message.t === "dispose")).toMatchObject({ handle: "temporary" });
  s.worker.postMessage({ t: "release", handles: temporary.args!.callbacks.map((entry) => entry.handle) });
  const barrier = await s.next((message) => message.method?.endsWith(".get") === true);
  s.worker.postMessage({ t: "result", id: barrier.id, ok: true, value: { data: marker } });
  expect(resultData(await s.next((message) => message.t === "result" && message.id === 911))).toMatchObject({
    ok: true,
    value: { toast: "released" },
  });
  s.worker.postMessage({ t: "invoke", id: 912, handle: temporaryHandle, args: [] });
  expect(await s.next((message) => message.t === "result" && message.id === 912)).toMatchObject({
    ok: false,
    code: "plugin/unavailable",
  });
  expect(s.messages.some((message) => message.t === "dispose")).toBe(false);
  s.worker.postMessage({ t: "release", handles: view.value!.callbacks.map((entry) => entry.handle) });
});

test("real Worker releases late registration receipts without interpreting business markers", async () => {
  const s = await command("pre-abort");
  await s.next((message) => message.t === "result" && message.id === 900);
  s.worker.postMessage({ t: "result", id: 998, ok: true, value: { __disposable: "ordinary" } });
  s.worker.postMessage({ t: "result", id: 999, ok: true, value: null, disposable: "late-registration" });
  expect(await s.next((message) => message.t === "dispose")).toMatchObject({ handle: "late-registration" });
  s.worker.postMessage({ t: "health", id: 913 });
  await s.next((message) => message.t === "healthy" && message.id === 913);
  expect(s.messages.some((message) => message.t === "dispose")).toBe(false);
});

test("real Worker rejects pre-aborted fetch without issuing a host request", async () => {
  const s = await command("pre-abort");
  expect(resultData(await s.next((message) => message.t === "result" && message.id === 900))).toMatchObject({
    ok: true,
    value: { toast: "already stopped" },
  });
  expect(s.messages.some((message) => message.method === "services.network.fetch")).toBe(false);
});

test("real Worker forwards in-flight cancellation and ignores a late response", async () => {
  const s = await command("live-abort");
  const request = await s.next((message) => message.method === "services.network.fetch");
  expect(await s.next((message) => message.t === "cancel")).toMatchObject({ id: request.id });
  expect(resultData(await s.next((message) => message.t === "result" && message.id === 900))).toMatchObject({
    ok: true,
    value: { toast: "stopped" },
  });
  s.worker.postMessage({ t: "result", id: request.id, ok: false, error: "late" });
  s.worker.postMessage({ t: "health", id: 902 });
  expect(await s.next((message) => message.t === "healthy")).toMatchObject({ id: 902 });
});

test("real Worker preserves network classification including a locally expired signal", async () => {
  const pre = await command("pre-timeout");
  expect(resultData(await pre.next((message) => message.t === "result" && message.id === 900))).toMatchObject({
    ok: true,
    value: { toast: "plugin/network-timeout" },
  });
  expect(pre.messages.some((message) => message.method === "services.network.fetch")).toBe(false);
  const live = await command("live-timeout");
  const call = await live.next((message) => message.method === "services.network.fetch");
  expect(await live.next((message) => message.t === "cancel")).toMatchObject({ id: call.id });
  expect(resultData(await live.next((message) => message.t === "result" && message.id === 900))).toMatchObject({
    ok: true,
    value: { toast: "plugin/network-timeout" },
  });
  const failed = await command("network-failure");
  const request = await failed.next((message) => message.method === "services.network.fetch");
  failed.worker.postMessage({ t: "result", id: request.id, ok: false, error: "Private native transport rejection" });
  expect(resultData(await failed.next((message) => message.t === "result" && message.id === 900))).toMatchObject({
    ok: true,
    value: { toast: "plugin/network-failed" },
  });
});

test("real Worker migration drains unawaited storage calls before returning migrated", async () => {
  const s = sandbox("migration");
  const registration = await s.next((message) => message.method === "contributions.commands.register");
  s.worker.postMessage({ t: "result", id: registration.id, ok: true, value: null, disposable: "registration" });
  await s.next((message) => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "migrating" } });
  s.worker.postMessage({ t: "migrate", id: 903, migration: { fromVersion: 1, toVersion: 2, direction: "upgrade" } });
  const write = await s.next((message) => message.method === "services.storage.set");
  s.worker.postMessage({ t: "health", id: 904 });
  await s.next((message) => message.t === "healthy");
  expect(s.messages.some((message) => message.t === "migrated")).toBe(false);
  s.worker.postMessage({ t: "result", id: write.id, ok: false, code: "db/locked", error: "write failed" });
  expect(await s.next((message) => message.t === "migrated")).toMatchObject({
    id: 903,
    ok: false,
    error: "write failed",
  });
});

test("real Worker action handles update before and after acknowledgement and retire across disposal races", async () => {
  const s = sandbox("action-state", "action-state-wire-probe.ts");
  const main = await s.next((message) => message.method === "contributions.commands.register");
  const handle = (data(main.args!) as { run: () => string }[])[0].run();
  s.worker.postMessage({ t: "result", id: main.id, ok: true, value: null, disposable: "main" });
  await s.next((message) => message.t === "ready");
  s.worker.postMessage({ t: "sync", patch: { phase: "active" } });
  s.worker.postMessage({ t: "invoke", id: 920, handle, args: [] });
  const child = await s.next((message) => message.method === "contributions.commands.register");
  s.worker.postMessage({ t: "health", id: 921 });
  await s.next((message) => message.t === "healthy" && message.id === 921);
  expect(s.messages.some((message) => message.method === "$registration.updateState")).toBe(false);
  s.worker.postMessage({ t: "result", id: child.id, ok: true, value: null, disposable: "child" });
  const first = await s.next((message) => message.method === "$registration.updateState");
  expect(data(first.args!)).toEqual(["child", { revision: 1, enabled: false, visible: true, checked: true }]);
  s.worker.postMessage({ t: "result", id: first.id, ok: true, value: { status: "applied" } });
  const second = await s.next((message) => message.method === "$registration.updateState");
  expect(data(second.args!)).toEqual(["child", { revision: 2, enabled: true, visible: false }]);
  s.worker.postMessage({ t: "result", id: second.id, ok: true, value: { status: "applied" } });
  expect(await s.next((message) => message.t === "dispose")).toMatchObject({ handle: "child" });
  const temporary = await s.next((message) => message.method === "contributions.commands.register");
  s.worker.postMessage({ t: "result", id: temporary.id, ok: true, value: null, disposable: "temporary" });
  expect(await s.next((message) => message.t === "dispose")).toMatchObject({ handle: "temporary" });
  const result = resultData(await s.next((message) => message.t === "result" && message.id === 920));
  expect(result).toMatchObject({
    ok: true,
    value: {
      toast: JSON.stringify({
        first: { status: "applied" },
        second: { status: "applied" },
        retired: { status: "inactive" },
        disposedBeforeAck: { status: "inactive" },
      }),
    },
  });
  expect(s.messages.some((message) => message.method === "$registration.updateState")).toBe(false);
});

test("Worker image inference transports owned resource IDs without image bytes or paths", async () => {
  const s = await command("image", "llm-probe.ts");
  const call = await s.next((message) => message.method === "services.llm.ask");
  expect(data(call.args!)).toEqual([{ prompt: "describe", images: [{ resourceId: "owned-image" }], model: "smart" }]);
  s.worker.postMessage({ t: "result", id: call.id, ok: true, value: "Visible diagram" });
  expect(resultData(await s.next((message) => message.t === "result" && message.id === 900))).toMatchObject({
    ok: true,
    value: { toast: "Visible diagram" },
  });
});
