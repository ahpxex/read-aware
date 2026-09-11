import { expect, test } from "bun:test";
import { pluginDurableKV } from "./plugin-durable-kv";
import { PluginLifecycleController } from "./plugin-lifecycle";
import { deferred } from "../../../../tests/helpers/profile-host";

test("durable private reads settle writes and namespace even path-looking keys literally", async () => {
  const lifecycle = new PluginLifecycleController([]); lifecycle.promote();
  const gate = deferred(), calls: string[] = [];
  const write = lifecycle.storageWrite("write", () => gate.promise);
  const read = pluginDurableKV(lifecycle, "owner:", { flush: async prefix => { calls.push(`flush:${prefix}`); },
    invoke: async <T>(_command: string, args?: unknown) => { expect(_command).toBe("get_kv"); calls.push((args as { key: string }).key); return '{"stored":true}' as T; } });
  const pending = read("../../foreign:key"); await Promise.resolve(); expect(calls).toEqual([]);
  gate.resolve(); await write; expect(await pending).toEqual({ stored: true });
  expect(calls).toEqual(["flush:owner:", "owner:../../foreign:key"]); lifecycle.stop();
});
test("invalid JSON/read failures reject, absent and JSON null agree, retirement drops late results", async () => {
  const lifecycle = new PluginLifecycleController([]); lifecycle.promote();
  let raw: string | null = null;
  const gate = deferred(), entered = deferred(); let pause = false;
  const read = pluginDurableKV(lifecycle, "owner:", { flush: async () => {}, invoke: async <T>() => {
    if (pause) { entered.resolve(); await gate.promise; } return raw as T;
  } });
  expect(await read("x")).toBeNull(); raw = "null"; expect(await read("x")).toBeNull(); raw = "{";
  await expect(read("x")).rejects.toMatchObject({ code: "db/error" });
  expect(() => read("bad\0key")).toThrow(); expect(() => read("x".repeat(1025))).toThrow();
  raw = '"private"'; pause = true; const pending = read("x"); await entered.promise; lifecycle.stop();
  await expect(pending).rejects.toMatchObject({ code: "plugin/cancelled" }); gate.resolve(); await lifecycle.drainCleanups();
  const active = new PluginLifecycleController([]); active.promote();
  const failed = pluginDurableKV(active, "owner:", { flush: async () => { throw Error("write failed"); }, invoke: async () => { throw Error("must not read"); } });
  await expect(failed("x")).rejects.toThrow("write failed"); active.stop();
});
