import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDefaultStore } from "jotai";
import { createSettingsDomain } from "./domain";
import { localKV, onLocalKVWrite } from "../../platform/local-store";
import { onAppEvent } from "../../platform/app-events";
import { appSettingsAtom, generalSettingsAtom } from "../../state/ui";
import { APP_SETTINGS_KEY, DEFAULT_APP_SETTINGS } from "../../features/settings/lib/app-settings";
import { GENERAL_SETTINGS_KEY, DEFAULT_GENERAL_SETTINGS } from "../../features/settings/lib/general-settings";
import { buildPluginSettingsView } from "../../features/plugins/lib/plugin-settings";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const disk = new Map<string, string>();
const pending: { entries: [string, string][]; resolve(): void; reject(error: unknown): void }[] = [];
const subscriptions: (() => void)[] = [];
let previousWindow: PropertyDescriptor | undefined;
let hold = false;

// Native detection and module-lifetime event clocks must not leak into other suites.
if (process.env.SETTINGS_DURABILITY_CASE === "1") {
beforeEach(async () => {
  previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    __TAURI_INTERNALS__: {
      invoke: (command: string, args: { key: string; value: string; entries: [string, string][] }) => {
        if (command === "local_device_get") return Promise.resolve({ deviceId: "settings-test", lastHlcWallMs: null, lastHlcCounter: null });
        if (command !== "set_kv" && command !== "set_kv_batch") return Promise.resolve();
        const entries: [string, string][] = command === "set_kv" ? [[args.key, args.value]] : args.entries;
        return new Promise<void>((resolve, reject) => {
          const commit = () => { for (const [key, value] of entries) disk.set(key, value); resolve(); };
          if (hold) pending.push({ entries, resolve: commit, reject }); else commit();
        });
      },
    },
  } });
  hold = false;
  await localKV.setItemAsync(APP_SETTINGS_KEY, JSON.stringify(DEFAULT_APP_SETTINGS));
  await localKV.setItemAsync(GENERAL_SETTINGS_KEY, JSON.stringify(DEFAULT_GENERAL_SETTINGS));
  hold = true;
});
afterEach(async () => {
  hold = false;
  for (const write of pending.splice(0)) write.resolve();
  await tick();
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("settings durable command boundary", () => {
  test("Agent and plugin updates wait for one native batch and publish only after commit", async () => {
    const events: string[] = [];
    const commits: string[] = [];
    const agent = createSettingsDomain("agent");
    subscriptions.push(agent.events.subscribe(event => events.push(event.origin)));
    subscriptions.push(onLocalKVWrite(key => commits.push(key)));
    let settled = false;
    const result = agent.commands.update([
      { path: "appearance.theme", value: "dark" },
      { path: "general.startView", value: "resume" },
    ]).then(value => { settled = true; return value; });
    await tick();
    expect(pending).toHaveLength(1);
    expect(pending[0].entries).toHaveLength(2);
    expect(getDefaultStore().get(appSettingsAtom).theme).toBe("dark");
    expect(getDefaultStore().get(generalSettingsAtom).startView).toBe("resume");
    expect(JSON.parse(disk.get(APP_SETTINGS_KEY)!).theme).toBe(DEFAULT_APP_SETTINGS.theme);
    expect(settled).toBe(false);
    expect(events).toEqual([]);
    expect(commits).toEqual([]);
    pending.shift()!.resolve();
    await result;
    expect(events).toEqual(["agent"]);
    expect(commits.sort()).toEqual([APP_SETTINGS_KEY, GENERAL_SETTINGS_KEY].sort());
    const plugin = createSettingsDomain("plugin:settings-test", { write: ["appearance.theme"] });
    const pluginResult = plugin.commands.update([{ path: "appearance.theme", value: "light" }]);
    await tick();
    expect(events).toEqual(["agent"]);
    pending.shift()!.resolve();
    expect((await pluginResult).settings.settings.map(entry => entry.path)).toEqual(["appearance.theme"]);
    expect(events).toEqual(["agent", "plugin:settings-test"]);
  });

  test("failure rolls back every atom before notification; the next actor cannot carry a rejected edit forward", async () => {
    const agent = createSettingsDomain("agent");
    const plugin = createSettingsDomain("plugin:settings-test", { write: ["appearance.motion"] });
    const events: string[] = [];
    const failureViews: unknown[] = [];
    subscriptions.push(agent.events.subscribe(event => events.push(event.origin)));
    subscriptions.push(onAppEvent("local-write-failed", () => failureViews.push([
      getDefaultStore().get(appSettingsAtom).theme,
      getDefaultStore().get(generalSettingsAtom).startView,
    ])));
    const failed = agent.commands.update([
      { path: "appearance.theme", value: "dark" },
      { path: "general.startView", value: "resume" },
    ]).catch(error => error);
    const next = plugin.commands.update([{ path: "appearance.motion", value: "reduced" }]);
    await tick();
    expect(pending).toHaveLength(1);
    pending.shift()!.reject({ code: "db/locked", message: "forced lock" });
    expect((await failed).code).toBe("db/locked");
    await tick();
    expect(failureViews).toEqual([[DEFAULT_APP_SETTINGS.theme, DEFAULT_GENERAL_SETTINGS.startView]]);
    expect(events).toEqual([]);
    expect(pending).toHaveLength(1);
    expect(JSON.parse(pending[0].entries[0][1]).theme).toBe(DEFAULT_APP_SETTINGS.theme);
    pending.shift()!.resolve(); await next;
    expect(getDefaultStore().get(appSettingsAtom)).toEqual({ ...DEFAULT_APP_SETTINGS, motion: "reduced" });
    expect(events).toEqual(["plugin:settings-test"]);
  });

  test("a plugin settings form returns the exact persistence failure instead of immediate success", async () => {
    const observed: unknown[] = [];
    subscriptions.push(onAppEvent("plugin-storage-changed", ({ pluginId }) => {
      if (pluginId === "settings-form-probe") observed.push(localKV.getItem("read-aware-plugin.settings-form-probe.settings"));
    }));
    const form = buildPluginSettingsView({
      id: "settings-form-probe", name: "Settings form", description: "test", version: "1.0.0", schemaVersion: 1,
      permissions: [], requires: {}, settings: [{ id: "enabled", kind: "toggle", label: "Enabled", value: false }],
    })!;
    const result = Promise.resolve(form.onSubmit({ enabled: true })).catch(error => error);
    await tick();
    expect(pending).toHaveLength(1);
    pending.shift()!.reject({ code: "db/locked", message: "form lock" });
    expect((await result).code).toBe("db/locked");
    expect(localKV.getItem("read-aware-plugin.settings-form-probe.settings")).toBeNull();
    expect(observed).toEqual([JSON.stringify({ enabled: true }), null]);
  });

  test("a command waits for native UI writes and does not carry their failed optimistic fields", async () => {
    getDefaultStore().set(appSettingsAtom, { ...DEFAULT_APP_SETTINGS, theme: "dark" });
    const update = createSettingsDomain("agent").commands.update([{ path: "appearance.motion", value: "reduced" }]);
    await tick();
    expect(pending).toHaveLength(1);
    pending.shift()!.reject({ code: "db/locked", message: "native UI lock" });
    await tick();
    expect(pending).toHaveLength(1);
    expect(JSON.parse(pending[0].entries[0][1])).toEqual({ ...DEFAULT_APP_SETTINGS, motion: "reduced" });
    pending.shift()!.resolve();
    await update;
  });

  test("matching an uncommitted UI value is not a successful no-op", async () => {
    getDefaultStore().set(appSettingsAtom, { ...DEFAULT_APP_SETTINGS, theme: "dark" });
    let settled = false;
    const update = createSettingsDomain("agent").commands.update([{ path: "appearance.theme", value: "dark" }]).then(result => {
      settled = true; return result;
    });
    await tick(); expect(settled).toBe(false);
    pending.shift()!.reject({ code: "db/locked", message: "native UI lock" });
    await tick(); expect(settled).toBe(false);
    expect(pending).toHaveLength(1);
    pending.shift()!.resolve(); await update;
    expect(JSON.parse(disk.get(APP_SETTINGS_KEY)!).theme).toBe("dark");
  });
});
} else {
  test("isolated native settings durability cases", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, SETTINGS_DURABILITY_CASE: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("5 pass");
  }, 30_000);
}
