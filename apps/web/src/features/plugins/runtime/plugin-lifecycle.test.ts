import { describe, expect, test } from "bun:test";
import type { PluginDisposable } from "@read-aware/plugin-types";
import { PluginLifecycleController } from "./plugin-lifecycle";

describe("plugin lifecycle barrier", () => {
  test("keeps registrations inert until explicit promotion", () => {
    const owned: PluginDisposable[] = [];
    const lifecycle = new PluginLifecycleController(owned);
    let live = 0;

    lifecycle.stage(() => {
      live += 1;
      return { dispose: () => (live -= 1) };
    });

    expect(live).toBe(0);
    expect(lifecycle.phase).toBe("activating");
    lifecycle.promote();
    expect(live).toBe(1);
    expect(lifecycle.phase).toBe("active");
    owned[0]?.dispose();
    expect(live).toBe(0);
  });

  test("allows only migration storage writes before activation", () => {
    const lifecycle = new PluginLifecycleController([]);
    expect(() => lifecycle.assertActive("domain write")).toThrow("activating");
    expect(() => lifecycle.assertStorageWrite("storage write")).toThrow("activating");

    lifecycle.beginMigration();
    expect(() => lifecycle.assertStorageWrite("storage write")).not.toThrow();
    expect(() => lifecycle.assertActive("domain write")).toThrow("migrating");
    lifecycle.finishMigration();
  });

  test("rolls back partial registration promotion", () => {
    const lifecycle = new PluginLifecycleController([]);
    let live = 0;
    lifecycle.stage(() => {
      live += 1;
      return { dispose: () => (live -= 1) };
    });
    lifecycle.stage(() => {
      throw new Error("bad registration");
    });

    expect(() => lifecycle.promote()).toThrow("bad registration");
    expect(live).toBe(0);
    expect(lifecycle.phase).toBe("activating");
  });

  test("stopping rejects new work but drains already accepted durable writes", async () => {
    const lifecycle = new PluginLifecycleController([]); lifecycle.promote();
    let finish!: () => void;
    const write = lifecycle.storageWrite("set", () => new Promise<void>(resolve => { finish = resolve; }));
    lifecycle.stop();
    expect(() => lifecycle.storageWrite("set", async () => {})).toThrow("stopped");
    expect(() => lifecycle.stage(() => ({ dispose() {} }))).toThrow("stopped");
    expect(() => lifecycle.promote()).toThrow("stopped");
    let drained = false;
    const drain = lifecycle.drainStorageWrites().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    finish(); await write; await drain; expect(drained).toBe(true);
  });

  test("migration can be stopped without reopening its write gate", () => {
    const lifecycle = new PluginLifecycleController([]); lifecycle.beginMigration(); lifecycle.stop();
    expect(() => lifecycle.finishMigration()).toThrow("stopped");
    expect(() => lifecycle.assertStorageWrite("set")).toThrow("stopped");
  });
});
