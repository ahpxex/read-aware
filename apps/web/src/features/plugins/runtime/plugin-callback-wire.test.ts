import { expect, test } from "bun:test";
import { decodePluginCallbacks, observePluginCallbackOwners, PluginCallbackRegistry, releasePluginCallbacks, type PluginCallbackWire } from "./plugin-callback-wire";

test("overlapping owner watches using the same callback remain independently disposable", () => {
  const owner = new AbortController(), registry = new PluginCallbackRegistry();
  const view = decodePluginCallbacks(registry.encode({ kind: "markdown", markdown: "No callbacks" }), () => null, undefined, owner.signal);
  let retired = 0;
  const close = () => { retired++; };
  const first = observePluginCallbackOwners(view, close);
  const second = observePluginCallbackOwners(view, close);
  first(); first(); owner.abort();
  expect(retired).toBe(1); second();
});

function roundtrip<T>(registry: PluginCallbackRegistry, value: T): T {
  const wire = structuredClone(registry.encode(value));
  return decodePluginCallbacks(wire, (handle, args) => registry.invoke(handle, args)) as T;
}

test("returned graph ownership releases aliases once without retiring other results", async () => {
  const registry = new PluginCallbackRegistry();
  const fn = () => 42;
  const raw = { fn, map: new Map<unknown, unknown>([[fn, fn]]), self: null as unknown };
  raw.self = raw;
  let releases = 0;
  const decode = () => decodePluginCallbacks(structuredClone(registry.encode(raw)),
    (handle, args) => registry.invoke(handle, args),
    handles => { releases += handles.length; registry.release(handles); }) as typeof raw;
  const first = decode(), second = decode();
  releasePluginCallbacks(first);
  releasePluginCallbacks(first);
  expect(releases).toBe(1);
  expect(registry.size).toBe(1);
  expect(first.self).toBe(first);
  expect(first.map.get(first.fn)).toBe(first.fn);
  await expect(first.fn()).rejects.toMatchObject({ code: "plugin/unavailable" });
  expect(second.fn()).toBe(42);
  releasePluginCallbacks(second);
  expect(registry.size).toBe(0);
});

test("business objects cannot become callbacks or disposal instructions", () => {
  const registry = new PluginCallbackRegistry();
  const value = {
    __fn: "h1", __disposable: "d1", data: { callbacks: [{ ref: {}, handle: "h1" }] },
    actual: (text: string) => text.toUpperCase(),
  };
  const received = roundtrip(registry, value);
  expect(received.__fn).toBe("h1");
  expect(received.__disposable).toBe("d1");
  expect(received.data).toEqual(value.data);
  expect(received.actual("real")).toBe("REAL");
  expect(registry.size).toBe(1);
});

test("identity metadata supports cycles, repeated functions, map keys and sets", () => {
  const registry = new PluginCallbackRegistry();
  const fn = () => 42;
  const value = { self: null as unknown, fn, same: fn, map: new Map<unknown, unknown>(), set: new Set<unknown>() };
  value.self = value;
  value.map.set(fn, value);
  value.set.add(fn); value.set.add(value);
  const received = roundtrip(registry, value);
  expect(received.self).toBe(received);
  expect(received.fn).toBe(received.same);
  expect(received.map.get(received.fn)).toBe(received);
  expect(received.set.has(received.fn)).toBe(true);
  expect(received.set.has(received)).toBe(true);
  expect(received.fn()).toBe(42);
  expect(registry.size).toBe(1);
});

test("null-prototype records, sparse arrays and special keys remain inert data", () => {
  const registry = new PluginCallbackRegistry();
  const record = Object.create(null);
  record.__proto__ = { polluted: true };
  record.constructor = { prototype: { polluted: true } };
  record.run = () => 7;
  const array = new Array(4);
  array[2] = record;
  const received = roundtrip(registry, array);
  expect(received.length).toBe(4); expect(0 in received).toBe(false);
  expect(Object.hasOwn(received[2], "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(received[2])).toBe(Object.prototype);
  expect(received[2].run()).toBe(7);
  expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
});

test("binary aliases and native structured-clone types are preserved", () => {
  const registry = new PluginCallbackRegistry();
  const buffer = new Uint8Array([0, 255]).buffer;
  const value = { buffer, bytes: new Uint8Array(buffer), date: new Date(1234), bigint: 42n };
  const received = roundtrip(registry, value);
  expect(received.bytes.buffer).toBe(received.buffer);
  expect([...received.bytes]).toEqual([0, 255]);
  expect(received.date.getTime()).toBe(1234);
  expect(received.bigint).toBe(42n);
});

test("each encoding has an independent lifetime, and release is idempotent", () => {
  const registry = new PluginCallbackRegistry();
  const fn = () => 9;
  const first = registry.encode(fn);
  const second = registry.encode(fn);
  registry.release(first.callbacks.map(entry => entry.handle));
  registry.release(first.callbacks.map(entry => entry.handle));
  expect(registry.size).toBe(1);
  expect(() => registry.invoke(first.callbacks[0].handle, [])).toThrow("released");
  expect(registry.invoke(second.callbacks[0].handle, [])).toBe(9);
  registry.clear(); expect(registry.size).toBe(0);
});

test("encoding and postMessage clone failures roll back all staged callbacks", () => {
  const registry = new PluginCallbackRegistry();
  expect(() => registry.encode({ run: () => 1, invalid: Symbol() })).toThrow();
  expect(registry.size).toBe(0);
  expect(() => registry.send({ run: () => 1, invalid: new WeakMap() }, wire => structuredClone(wire))).toThrow();
  expect(registry.size).toBe(0);
  for (let i = 0; i < 5000; i++) registry.send({ run: () => i }, wire => {
    registry.release(wire.callbacks.map(entry => entry.handle));
  });
  expect(registry.size).toBe(0);
});

test("malformed or detached callback metadata is rejected without invoking code", () => {
  const ref = {};
  const cases: PluginCallbackWire[] = [
    { data: {}, callbacks: [{ ref, handle: "h1" }] },
    { data: ref, callbacks: [{ ref, handle: "constructor" }] },
    { data: ref, callbacks: [{ ref, handle: "h1" }, { ref, handle: "h2" }] },
  ];
  for (const wire of cases) expect(() => decodePluginCallbacks(wire, () => { throw new Error("must not invoke"); })).toThrow("Invalid plugin callback payload");
});

test("graph depth and callback quotas fail deterministically without partial retention", () => {
  const registry = new PluginCallbackRegistry();
  let nested: unknown = {};
  for (let i = 0; i < 150; i++) nested = { nested };
  expect(() => registry.encode({ run: () => 1, nested })).toThrow();
  expect(registry.size).toBe(0);
  expect(() => registry.encode(Array.from({ length: 100_001 }, (_, index) => () => index))).toThrow("Too many callbacks");
  expect(registry.size).toBe(0);
});
