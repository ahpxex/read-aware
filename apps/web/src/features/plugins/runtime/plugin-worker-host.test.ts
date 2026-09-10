import { describe, expect, spyOn, test } from "bun:test";
import type { PluginContext, PluginDisposable } from "../lib/plugin-types";
import { getDefaultStore } from "jotai";
import { contextActionsAtom, pluginCommandsAtom } from "../state/plugin-store";
import { describeContext, startPluginWorker } from "./plugin-worker-host";
import { PluginCallbackRegistry, pluginCallbackOwner, retainPluginCallbacks } from "./plugin-callback-wire";
import { openPluginViewChannel } from "../lib/plugin-view-channels";
import { PluginLifecycleController } from "./plugin-lifecycle";
import * as runtimeModule from "../../ai/agent/agent-runtime";
import type { AgentRuntime, OneShotInput } from "@read-aware/agent";
import type { PluginPermission } from "@read-aware/core";
import * as contentNavigation from "../../library/lib/book-content-navigation";
import { readingRuntime } from "../../../domain/reading-runtime";

type WireMessage = { t: string; id?: number; handle?: string; handles?: string[]; disposable?: string; [key: string]: unknown };

/** Deterministic transport faults, with the real host context and registration path. */
class FaultWorker {
  static current: FaultWorker;
  onmessage: ((event: MessageEvent) => Promise<void>) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly sent: WireMessage[] = [];
  readonly callbacks = new PluginCallbackRegistry();
  terminated = false;
  constructor() { FaultWorker.current = this; }
  postMessage(message: WireMessage) {
    this.sent.push(message);
    if (message.t === "boot") queueMicrotask(() => { void this.deliver({ t: "ready", hasMigration: false }); });
    if (message.t === "quiesce") queueMicrotask(() => { void this.deliver({ t: "quiesced" }); });
    if (message.t === "release") this.callbacks.release(message.handles!);
  }
  async deliver(message: WireMessage) { await this.onmessage?.({ data: message } as MessageEvent); }
  terminate() { this.terminated = true; this.callbacks.clear(); }
}

async function hostFixture(permissions: PluginPermission[] = []) {
  const native = globalThis.Worker;
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); },
  };
  const disposables: PluginDisposable[] = [];
  globalThis.Worker = FaultWorker as unknown as typeof Worker;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  let started: ReturnType<typeof startPluginWorker>;
  try {
    started = startPluginWorker({ id: "callback-host-test", name: "Callback host test", version: "1.0.0", schemaVersion: 1, permissions, requires: {} }, "1.0.0", disposables, { moduleUrl: "test:callback" });
  } finally {
    globalThis.Worker = native;
    if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
  const runtime = await started;
  runtime.promote();
  const worker = FaultWorker.current;
  return {
    worker,
    async close() {
      try { await runtime.terminate(); }
      finally { for (const disposable of disposables.reverse()) disposable.dispose(); }
    },
  };
}

describe("plugin worker capability bridge", () => {
  test("derives deeply nested domain and contribution methods from the actor view", () => {
    const context = {
      domains: {
        library: {
          queries: { books: { list: () => [] } },
          commands: { books: { importBook: () => null } },
          events: { subscribe: () => ({ dispose() {} }) },
        },
      },
      contributions: {
        contentProviders: { register: () => ({ dispose() {} }) },
      },
      services: {},
    } as unknown as PluginContext;

    expect(describeContext(context)).toMatchObject({
      domains: {
        library: {
          queries: { books: { list: "fn" } },
          commands: { books: { importBook: "fn" } },
          events: { subscribe: "fn" },
        },
      },
      contributions: {
        contentProviders: { register: "fn" },
      },
    });
  });
});

test.each(["query", "navigation"])("%s RPC cancellation reaches the existing domain, not a forged options signal", async kind => {
  let started!: () => void, signal: AbortSignal | undefined;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const run = (value?: AbortSignal): Promise<never> => {
    signal = value; started();
    return new Promise((_, reject) => value!.addEventListener("abort", () => reject(value!.reason), { once: true }));
  };
  const spy = kind === "query" ? spyOn(contentNavigation, "searchBookLocations").mockImplementation((_input, value) => run(value))
    : spyOn(readingRuntime, "step").mockImplementation((_direction, value, guard) => { expect(guard).toEqual({ sessionId: "active" }); return run(value); });
  const { worker, close } = await hostFixture(["library:read", "reading:write"]);
  try {
    const method = kind === "query" ? "domains.library.queries.books.searchLocations" : "domains.reading.commands.step";
    const args = kind === "query" ? [{ bookId: "b", query: "q" }, { signal: { forged: true } }]
      : ["next", { sessionId: "active" }, { signal: { forged: true } }];
    const call = worker.deliver({ t: "call", id: 991, method, args: worker.callbacks.encode(args) });
    await ready;
    expect(signal).toBeInstanceOf(AbortSignal); expect(signal?.aborted).toBe(false);
    await worker.deliver({ t: "cancel", id: 991 }); await call;
    expect(signal?.aborted).toBe(true);
    expect(worker.sent.find(message => message.t === "result" && message.id === 991)).toMatchObject({ ok: false, code: "plugin/cancelled" });
  } finally { await close(); spy.mockRestore(); }
});

test.each(["ask", "askDetailed"])("LLM %s RPC cancellation injects the current request signal into the actual host service", async method => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let signal: AbortSignal | undefined;
  const run = (input: OneShotInput) => {
    signal = input.signal; started();
    return new Promise((_, reject) => input.signal!.addEventListener("abort", () => reject(input.signal!.reason), { once: true }));
  };
  const runtime = { ask: run, askDetailed: run } as unknown as AgentRuntime;
  const spy = spyOn(runtimeModule, "getAgentRuntime").mockReturnValue(runtime);
  const { worker, close } = await hostFixture(["service:llm"]);
  try {
    const call = worker.deliver({ t: "call", id: 990, method: `services.llm.${method}`, args: worker.callbacks.encode([{ prompt: "p", signal: { fake: true } }]) });
    await ready;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    await worker.deliver({ t: "cancel", id: 990 });
    await call;
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toMatchObject({ code: "ai/request-cancelled" });
    expect(worker.sent.find(message => message.t === "result" && message.id === 990)).toMatchObject({ ok: false, code: "plugin/cancelled" });
  } finally { await close(); spy.mockRestore(); }
});

test("host releases denied and invalid call arguments without granting authority", async () => {
  const { worker, close } = await hostFixture();
  try {
    await worker.deliver({ t: "call", id: 1, method: "domains.library.commands.books.remove", args: worker.callbacks.encode([() => null]) });
    expect(worker.sent.find(message => message.t === "result" && message.id === 1)).toMatchObject({ ok: false, code: "plugin/unavailable" });
    expect(worker.callbacks.size).toBe(0);
    await worker.deliver({ t: "call", id: 2, method: "contributions.commands.register", args: worker.callbacks.encode({ run: () => null }) });
    expect(worker.sent.find(message => message.t === "result" && message.id === 2)).toMatchObject({ ok: false, code: "plugin/invalid-input" });
    expect(worker.callbacks.size).toBe(0);
  } finally { await close(); }
});

test("action state RPC owns exact live registrations and rejects unsupported or invalid updates", async () => {
  const { worker, close } = await hostFixture();
  let id = 100;
  const call = async (method: string, args: unknown[]) => {
    const request = id++;
    await worker.deliver({ t: "call", id: request, method, args: worker.callbacks.encode(args) });
    return worker.sent.find(message => message.t === "result" && message.id === request)!;
  };
  try {
    const first = await call("contributions.commands.register", [{ id: "mutable", title: "Mutable", run() {} }]);
    const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.key === "callback-host-test:mutable")!;
    expect(pluginCallbackOwner(command.run)).toBeDefined();
    expect(await call("$registration.updateState", [first.disposable, { revision: 1, enabled: false, visible: true, checked: true }]))
      .toMatchObject({ ok: true, value: { status: "applied" } });
    expect(command.run).toThrow(expect.objectContaining({ code: "plugin/action-disabled" }));
    expect(worker.sent.some(message => message.t === "invoke")).toBe(false);
    expect(await call("$registration.updateState", [first.disposable, { revision: 1, enabled: true, visible: true }]))
      .toMatchObject({ ok: true, value: { status: "stale" } });
    expect(await call("$registration.updateState", [first.disposable, undefined]))
      .toMatchObject({ ok: false, code: "plugin/invalid-input" });
    await call("contributions.commands.register", [{ id: "mutable", title: "Replacement", run() {} }]);
    expect(await call("$registration.updateState", [first.disposable, { revision: 100, enabled: false, visible: false }]))
      .toMatchObject({ ok: true, value: { status: "inactive" } });
    await worker.deliver({ t: "dispose", handle: first.disposable });
    expect(await call("$registration.updateState", [first.disposable, {}])).toMatchObject({ ok: true, value: { status: "inactive" } });
    expect(await call("$registration.updateState", ["unknown-or-foreign", {}])).toMatchObject({ ok: true, value: { status: "inactive" } });
    expect(await call("$registration.updateState", [null, {}])).toMatchObject({ ok: false, code: "plugin/invalid-input" });
    const subscription = await call("services.session.observeEnvironment", [() => {}]);
    expect(subscription.ok).toBe(true);
    const notification = worker.sent.findLast(message => message.t === "invoke")!;
    await worker.deliver({ t: "result", id: notification.id, ok: true, value: worker.callbacks.encode(null) });
    expect(await call("$registration.updateState", [subscription.disposable, { revision: 1, enabled: false, visible: false }]))
      .toMatchObject({ ok: false, code: "plugin/unavailable" });
    await worker.deliver({ t: "dispose", handle: subscription.disposable });
  } finally { await close(); }
});

test("context action RPC carries target metadata and owns state updates through disposal", async () => {
  const { worker, close } = await hostFixture();
  try {
    await worker.deliver({ t: "call", id: 1, method: "contributions.contextActions.register", args: worker.callbacks.encode([
      { id: "book", title: "Book action", surface: "book", run() {} },
    ]) });
    const receipt = worker.sent.find(message => message.t === "result" && message.id === 1)!;
    expect(receipt).toMatchObject({ ok: true });
    expect(receipt.disposable).toBeString();
    const action = getDefaultStore().get(contextActionsAtom).find(item => item.pluginId === "callback-host-test")!;
    const input = { surface: "book" as const, book: { id: "b", title: "Book" } };
    const pending = Promise.resolve(action.run(input)).catch(error => error);
    const invocation = worker.sent.findLast(message => message.t === "invoke")!;
    expect(invocation.args).toEqual([input]);
    await worker.deliver({ t: "result", id: invocation.id, ok: true, value: worker.callbacks.encode(null) });
    expect(await pending).toBeNull();
    await worker.deliver({ t: "call", id: 2, method: "$registration.updateState", args: worker.callbacks.encode([
      receipt.disposable, { revision: 1, visible: true, enabled: false },
    ]) });
    expect(worker.sent.find(message => message.t === "result" && message.id === 2)).toMatchObject({ ok: true, value: { status: "applied" } });
    expect(() => action.run(input)).toThrow(expect.objectContaining({ code: "plugin/action-disabled" }));
    await worker.deliver({ t: "dispose", handle: receipt.disposable });
    expect(getDefaultStore().get(contextActionsAtom).some(item => item.pluginId === "callback-host-test")).toBe(false);
    expect(worker.callbacks.size).toBe(0);
  } finally { await close(); }
});

test("ordinary API arguments can transfer callback ownership to a live view without retaining discarded fields", async () => {
  const { worker, close } = await hostFixture();
  let release = () => {};
  let channel: ReturnType<typeof openPluginViewChannel> | undefined;
  try {
    await worker.deliver({ t: "call", id: 1, method: "contributions.commands.register", args: worker.callbacks.encode([{ id: "test", title: "Test", run: () => null }]) });
    const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === "callback-host-test")!;
    const owner = pluginCallbackOwner(command.run)!;
    expect(owner).toBeDefined();
    let action!: () => unknown;
    channel = openPluginViewChannel(owner, update => {
      if (update.view.kind !== "detail") throw Error("Expected detail");
      action = update.view.actions![0].run;
      release = retainPluginCallbacks(action);
    });
    await worker.deliver({ t: "call", id: 2, method: "services.ui.publishView", args: worker.callbacks.encode([channel.channel, {
      revision: 1, view: { kind: "detail", content: [], actions: [{ id: "retained", label: "Retained", run: () => null }], discarded: () => null },
    }]) });
    expect(worker.sent.find(message => message.t === "result" && message.id === 2)).toMatchObject({ ok: true, value: { status: "applied" } });
    expect(worker.callbacks.size).toBe(2);
    const invoked = action();
    const request = worker.sent.findLast(message => message.t === "invoke")!;
    await worker.deliver({ t: "result", id: request.id, ok: true, value: worker.callbacks.encode({ toast: "Still callable" }) });
    expect(await invoked).toEqual({ toast: "Still callable" });
    release(); expect(worker.callbacks.size).toBe(1);
    await expect(action()).rejects.toMatchObject({ code: "plugin/unavailable" });
  } finally { release(); channel?.dispose(); await close(); }
});

test("host releases malformed and unmatched callback results and disposed registrations", async () => {
  const { worker, close } = await hostFixture();
  try {
    await worker.deliver({ t: "call", id: 1, method: "contributions.commands.register", args: worker.callbacks.encode([{ id: "test", title: "Test", run: () => null }]) });
    const receipt = worker.sent.find(message => message.t === "result" && message.id === 1)!;
    expect(receipt).toMatchObject({ ok: true, value: null });
    expect(receipt.disposable).toBeString();
    if (typeof receipt.disposable !== "string") throw new Error("Missing registration receipt");
    const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === "callback-host-test")!;
    const pending = Promise.resolve(command.run()).catch(error => error);
    const invocation = worker.sent.find(message => message.t === "invoke")!;
    const malformed = worker.callbacks.encode({ run: () => null });
    malformed.data = {};
    await worker.deliver({ t: "result", id: invocation.id, ok: true, value: malformed });
    expect(await pending).toMatchObject({ code: "plugin/invalid-input" });
    expect(worker.callbacks.size).toBe(1);
    await worker.deliver({ t: "result", id: invocation.id, ok: true, value: worker.callbacks.encode({ run: () => null }) });
    expect(worker.callbacks.size).toBe(1);
    await worker.deliver({ t: "dispose", handle: receipt.disposable });
    await worker.deliver({ t: "dispose", handle: receipt.disposable });
    expect(worker.callbacks.size).toBe(0);
    expect(getDefaultStore().get(pluginCommandsAtom).some(item => item.pluginId === "callback-host-test")).toBe(false);
  } finally { await close(); }
});

test("shutdown still drains durable writes and terminates its Worker when registration cleanup fails", async () => {
  const { worker, close } = await hostFixture();
  let finishDrain!: () => void;
  let drainStarted = false;
  const drain = spyOn(PluginLifecycleController.prototype, "drainStorageWrites").mockImplementation(() => {
    drainStarted = true;
    return new Promise<void>(resolve => { finishDrain = resolve; });
  });
  let unsubscribe: (() => void) | undefined;
  try {
    await worker.deliver({ t: "call", id: 1, method: "contributions.commands.register", args: worker.callbacks.encode([{ id: "test", title: "Test", run: () => null }]) });
    unsubscribe = getDefaultStore().sub(pluginCommandsAtom, () => { throw new Error("registry observer failed"); });
    const closing = close().catch(error => error);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(drainStarted).toBe(true);
    expect(worker.terminated).toBe(false);
    finishDrain();
    expect(await closing).toBeInstanceOf(AggregateError);
    expect(worker.terminated).toBe(true);
    expect(getDefaultStore().get(pluginCommandsAtom).some(item => item.pluginId === "callback-host-test")).toBe(false);
  } finally {
    unsubscribe?.(); drain.mockRestore();
    if (!worker.terminated) { finishDrain?.(); await close().catch(() => { /* Expected injected shutdown failure. */ }); }
  }
});
