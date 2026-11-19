import { expect, test } from "bun:test";
import { parsePluginWorkerMessage, type WorkerMessage } from "./plugin-worker-protocol";
import { assertPluginWireBudget, PLUGIN_WIRE_LIMITS } from "./plugin-wire-budget";
import { PluginCallbackRegistry } from "./plugin-callback-wire";

test("every Worker envelope is explicit, bounded, and rejects extra authority fields", () => {
  const registry = new PluginCallbackRegistry();
  const valid: WorkerMessage[] = [
    { t: "hello", protocolVersion: 1 },
    { t: "ready", protocolVersion: 1, hasMigration: false },
    { t: "failed", error: "failed" },
    { t: "dispose", handle: "d1" },
    { t: "call", id: 1, method: "domains.library.queries.books.list", args: registry.encode([]) },
    { t: "cancel", id: 1 },
    { t: "healthy", id: 1 },
    { t: "migrated", id: 1, ok: true },
    { t: "migrated", id: 1, ok: false, error: "failed" },
    { t: "quiesced" },
    { t: "quiesced", error: "failed" },
    { t: "result", id: 1, ok: true, value: registry.encode({ action: () => 42 }) },
    { t: "result", id: 1, ok: false, error: "failed", code: "db/error" },
    { t: "result", id: 1, ok: false, error: "failed", stack: "Error: failed\n    at action (plugin.js:1:2)" },
    { t: "migrated", id: 1, ok: false, error: "failed", stack: "Error: failed" },
  ];
  for (const message of valid) {
    expect(parsePluginWorkerMessage(structuredClone(message))).toEqual(structuredClone(message));
    expect(() => parsePluginWorkerMessage({ ...message, authority: true })).toThrow();
  }
  for (const message of [
    null,
    undefined,
    "call",
    [],
    {},
    { t: "ready" },
    { t: "migrated", id: 1, ok: "yes" },
    { t: "call", id: 1, method: {}, args: registry.encode([]) },
    { t: "dispose", handle: null },
    { t: "call", id: 1, method: "x", args: registry.encode({}) },
    { t: "result", id: 1, ok: false, error: "x".repeat(4097) },
    { t: "result", id: 1, ok: false, error: "failed", stack: "x".repeat(4097) },
    { t: "result", id: 1, ok: false, error: "failed", stack: ["at x"] },
    { t: "migrated", id: 1, ok: false, error: "failed", stack: 1 },
    { t: "result", id: 1, ok: true, value: registry.encode(null), stack: "Error" },
  ])
    expect(() => parsePluginWorkerMessage(message)).toThrow();
  for (const id of [0, -1, 1.5, NaN, Infinity, "1", Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => parsePluginWorkerMessage({ t: "cancel", id })).toThrow();
  }
});

test("message budgets count string keys, backing buffers, blobs, errors, maps and cycles", () => {
  const small = { ...PLUGIN_WIRE_LIMITS, bytes: 512, entries: 100, depth: 8 };
  const buffer = new ArrayBuffer(400),
    alias = new Uint8Array(buffer, 0, 1);
  expect(() => assertPluginWireBudget([buffer, alias], small)).not.toThrow();
  expect(() => assertPluginWireBudget(new Uint8Array(new ArrayBuffer(600), 0, 1), small)).toThrow();
  for (const value of [
    "x".repeat(300),
    { ["x".repeat(300)]: 0 },
    new Blob([new Uint8Array(600)]),
    new Map([[1, "x".repeat(300)]]),
    new Set(["x".repeat(300)]),
    new Error("x".repeat(300)),
    new File([], "x".repeat(300)),
    new Blob([], { type: "x".repeat(300) }),
    new Array(101),
    new WeakMap(),
    new SharedArrayBuffer(10),
  ])
    expect(() => assertPluginWireBudget(value, small)).toThrow();
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  expect(() => assertPluginWireBudget(cyclic, small)).not.toThrow();
  let deep: unknown = null;
  for (let i = 0; i < 10; i++) deep = { next: deep };
  expect(() => assertPluginWireBudget(deep, small)).toThrow();
});

test("sender preflight failures release staged callbacks and total retained handles stay bounded", () => {
  const registry = new PluginCallbackRegistry();
  expect(() =>
    registry.send({ callback: () => 1, huge: new Array(1_000_001) }, (wire) => {
      parsePluginWorkerMessage({ t: "result", id: 1, ok: true, value: wire });
    }),
  ).toThrow();
  expect(registry.size).toBe(0);
  const batch = Array.from({ length: PLUGIN_WIRE_LIMITS.callbacksPerMessage }, (_, index) => () => index);
  const first = registry.encode(batch),
    second = registry.encode(batch);
  expect(registry.size).toBe(PLUGIN_WIRE_LIMITS.retainedCallbacks);
  expect(() => registry.encode(() => 1)).toThrow();
  expect(registry.size).toBe(PLUGIN_WIRE_LIMITS.retainedCallbacks);
  registry.release(first.callbacks.map((entry) => entry.handle));
  expect(() => registry.encode(() => 1)).not.toThrow();
  registry.release(second.callbacks.map((entry) => entry.handle));
  registry.clear();
  expect(registry.size).toBe(0);
});

test("reaction envelopes carry only a bounded opaque host lease, never an actor or a causal path", () => {
  const args = new PluginCallbackRegistry().encode([]);
  const call = { t: "call", id: 1, method: "services.storage.getDurable", args };
  expect(parsePluginWorkerMessage({ ...call, reaction: { id: "opaque", status: "ready" } })).toMatchObject({
    reaction: { id: "opaque" },
  });
  for (const reaction of [
    null,
    {},
    { id: "", status: "ready" },
    { id: "x".repeat(65), status: "ready" },
    { id: "opaque", status: "ready", actor: "user" },
    { id: "opaque", status: "ready", steps: [] },
    { id: "opaque", status: "forged" },
  ])
    expect(() => parsePluginWorkerMessage({ ...call, reaction })).toThrow();
});
