import { expect, spyOn, test } from "bun:test";
import type { PluginDisposable, SettingsObservation } from "@read-aware/plugin-types";
import { buildPluginContext } from "../../features/plugins/runtime/plugin-context";
import { localKV } from "../../platform/local-store";

test("settings reads work during activation but captured queries and staged observers cannot outlive their actor", async () => {
  const owned: PluginDisposable[] = [];
  const runtime = buildPluginContext({
    id: "settings-lifecycle-test", name: "Settings lifecycle", version: "1.0.0", schemaVersion: 1,
    requires: { domains: { settings: "^1.6.0" } },
    settingsAccess: { discover: ["appearance.theme"], read: ["appearance.theme"] },
  }, "0.5.4", owned);
  const queries = runtime.context.domains.settings.queries;
  const seen: SettingsObservation[] = [];
  const read = spyOn(localKV, "getItem").mockReturnValue(null);
  try {
    expect((await queries.snapshot()).settings.map(setting => setting.path)).toEqual(["appearance.theme"]);
    expect(await queries.discover()).toHaveLength(1);
    expect((await queries.read("appearance.theme")).path).toBe("appearance.theme");
    let initial!: () => void;
    const delivered = new Promise<void>(resolve => { initial = resolve; });
    queries.observe({}, state => { seen.push(state); initial(); });
    await Promise.resolve();
    expect(seen).toHaveLength(0);
    runtime.lifecycle.promote();
    await delivered;
    expect(seen).toHaveLength(1);
    const pending = queries.snapshot();
    runtime.lifecycle.stop();
    await expect(pending).rejects.toThrow();
    await expect(queries.snapshot()).rejects.toThrow();
    await expect(queries.discover()).rejects.toThrow();
    await expect(queries.read("appearance.theme")).rejects.toThrow();
    expect(() => queries.observe({}, state => { seen.push(state); })).toThrow();
    await Promise.resolve();
    expect(seen).toHaveLength(1);
  } finally {
    runtime.lifecycle.stop();
    read.mockRestore();
  }
});
