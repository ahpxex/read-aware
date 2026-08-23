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
});
