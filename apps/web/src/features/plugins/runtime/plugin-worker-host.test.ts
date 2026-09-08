import { describe, expect, test } from "bun:test";
import type { PluginContext, PluginDisposable } from "../lib/plugin-types";
import { getDefaultStore } from "jotai";
import { pluginCommandsAtom } from "../state/plugin-store";
import { describeContext, startPluginWorker } from "./plugin-worker-host";
import { PluginCallbackRegistry } from "./plugin-callback-wire";

type WireMessage = { t: string; id?: number; handle?: string; handles?: string[]; [key: string]: unknown };

/** Deterministic transport faults, with the real host context and registration path. */
class FaultWorker {
  static current: FaultWorker;
  onmessage: ((event: MessageEvent) => Promise<void>) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly sent: WireMessage[] = [];
  readonly callbacks = new PluginCallbackRegistry();
  constructor() { FaultWorker.current = this; }
  postMessage(message: WireMessage) {
    this.sent.push(message);
    if (message.t === "boot") queueMicrotask(() => { void this.deliver({ t: "ready", hasMigration: false }); });
    if (message.t === "quiesce") queueMicrotask(() => { void this.deliver({ t: "quiesced" }); });
    if (message.t === "release") this.callbacks.release(message.handles!);
  }
  async deliver(message: WireMessage) { await this.onmessage?.({ data: message } as MessageEvent); }
  terminate() { this.callbacks.clear(); }
}

async function hostFixture() {
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
    started = startPluginWorker({ id: "callback-host-test", name: "Callback host test", version: "1.0.0", schemaVersion: 1, permissions: [], requires: {} }, "1.0.0", disposables, { moduleUrl: "test:callback" });
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
