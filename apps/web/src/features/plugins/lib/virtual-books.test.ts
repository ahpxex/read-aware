import { afterEach, beforeEach, expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { bindVirtualBook, getVirtualBookBinding, removeOwnedVirtualBook, unbindVirtualBook } from "./virtual-books";

const registryKey = "read-aware-virtual-books";
const binding = { pluginId: "virtual-test", providerId: "content", key: "feed" };
let previous: PropertyDescriptor | undefined;
let failWrite = false;
const values = new Map<string, string>();
beforeEach(() => {
  previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  values.clear(); failWrite = false;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { if (failWrite) throw new AppError("db/locked", "Injected binding failure"); values.set(key, value); },
  } });
});
afterEach(() => {
  if (previous) Object.defineProperty(globalThis, "localStorage", previous);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

test("virtual removal propagates book failure and preserves the exact binding", async () => {
  bindVirtualBook("book", binding);
  const error = new AppError("db/locked", "Injected deletion failure");
  await expect(removeOwnedVirtualBook(binding, async () => { throw error; })).rejects.toBe(error);
  expect(getVirtualBookBinding("book")).toEqual(binding);
});

test("binding cleanup failure is not acknowledged, and a retry finishes after a committed deletion", async () => {
  bindVirtualBook("book", binding);
  let removals = 0;
  const remove = async (id: string) => { expect(id).toBe("book"); removals++; };
  failWrite = true;
  await expect(removeOwnedVirtualBook(binding, remove)).rejects.toMatchObject({ code: "db/locked" });
  expect(getVirtualBookBinding("book")).toEqual(binding);
  failWrite = false;
  await removeOwnedVirtualBook(binding, remove);
  expect(getVirtualBookBinding("book")).toBeNull();
  await removeOwnedVirtualBook(binding, remove);
  expect(removals).toBe(2);
});

test("binding remains until deletion finishes and other owners are preserved", async () => {
  bindVirtualBook("book", binding);
  const foreign = { ...binding, pluginId: "other" };
  bindVirtualBook("foreign", foreign);
  let finish!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const pending = removeOwnedVirtualBook(binding, () => new Promise<void>(resolve => { finish = resolve; started(); }));
  await ready;
  expect(getVirtualBookBinding("book")).toEqual(binding);
  finish(); await pending;
  expect(getVirtualBookBinding("foreign")).toEqual(foreign);
  expect(JSON.parse(values.get(registryKey)!)).toEqual({ foreign });
});

test("shared event cleanup is idempotent and a changed binding is never removed", async () => {
  bindVirtualBook("book", binding);
  await removeOwnedVirtualBook(binding, async id => { unbindVirtualBook(id); });
  expect(getVirtualBookBinding("book")).toBeNull();
  bindVirtualBook("book", binding);
  const replacement = { ...binding, key: "new" };
  await expect(removeOwnedVirtualBook(binding, async id => { bindVirtualBook(id, replacement); })).rejects.toMatchObject({ code: "plugin/unavailable" });
  expect(getVirtualBookBinding("book")).toEqual(replacement);
});

test("corrupt registry is a failed read, never a successful no-op deletion or overwrite", async () => {
  for (const raw of ["{", "[]", "null", '{"book":null}', '{"book":{"pluginId":"p"}}']) {
    values.set(registryKey, raw);
    let removed = false;
    await expect(removeOwnedVirtualBook(binding, async () => { removed = true; })).rejects.toMatchObject({ code: "db/error" });
    expect(removed).toBe(false);
    expect(() => bindVirtualBook("new", binding)).toThrow();
    expect(values.get(registryKey)).toBe(raw);
  }
});
