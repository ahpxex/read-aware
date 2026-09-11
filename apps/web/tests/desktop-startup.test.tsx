import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChoiceGroup, ToastProvider, Toggle } from "@read-aware/ui";
import { createSettingsDomain } from "../src/domain/settings/domain";
import { localKV } from "../src/platform/local-store";
import { desktopStartup } from "../src/platform/desktop-startup";
import { GENERAL_SETTINGS_KEY, DEFAULT_GENERAL_SETTINGS } from "../src/features/settings/lib/general-settings";
import { initI18n } from "../src/i18n";
import { GeneralPanel } from "../src/features/settings/sections/GeneralPanel";
import { buildPluginContext } from "../src/features/plugins/runtime/plugin-context";

if (process.env.DESKTOP_STARTUP_CASE === "1") {
  const tick = () => Bun.sleep(0);
  function environment() {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
    const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
      localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
    const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
    const disk = new Map<string, string>(), writes: [string, string | null][][] = [];
    let enabled = false;
    const adapter = { read: async (): Promise<unknown> => enabled, persist: async () => {} };
    let reads = 0;
    Object.assign(dom.window, { __TAURI_INTERNALS__: { invoke: async (command: string, args: { key: string; value: string; entries: [string, string | null][] }) => {
      if (command === "desktop_startup_enabled") { reads++; return adapter.read(); }
      if (command === "local_device_get") return { deviceId: "startup-test", lastHlcWallMs: null, lastHlcCounter: null };
      if (command !== "set_kv" && command !== "set_kv_batch") return null;
      const entries: [string, string | null][] = command === "set_kv" ? [[args.key, args.value]] : args.entries;
      writes.push(entries);
      await adapter.persist();
      for (const [key, value] of entries) {
        if (value === null) disk.delete(key); else disk.set(key, value);
        if (key === GENERAL_SETTINGS_KEY) enabled = value === null ? false : JSON.parse(value).launchAtStartup;
      }
    } } });
    return { dom, disk, writes, adapter, reads: () => reads, actual: () => enabled,
      external: (value: boolean) => { enabled = value; },
      initialize: async () => { await localKV.setItemAsync(GENERAL_SETTINGS_KEY, JSON.stringify(DEFAULT_GENERAL_SETTINGS)); writes.length = 0; },
      close: () => {
        dom.window.close();
        for (const [key, descriptor] of saved) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
        }
      },
    };
  }

  test("read uses system state, discovery does not read it, and denied actors cannot reach native state", async () => {
    const f = environment();
    try {
      await f.initialize(); f.external(true);
      const agent = createSettingsDomain("agent");
      expect((await agent.queries.read("general.launchAtStartup")).value).toBe(true);
      expect(JSON.parse(f.disk.get(GENERAL_SETTINGS_KEY)!).launchAtStartup).toBe(false);
      const reads = f.reads();
      const denied = createSettingsDomain("plugin:denied");
      expect((await denied.queries.snapshot()).settings).toEqual([]);
      await expect(denied.queries.read("general.launchAtStartup")).rejects.toThrow("not permitted");
      await expect(denied.commands.update([{ path: "general.launchAtStartup", value: false }])).rejects.toThrow("not permitted");
      expect((await agent.queries.discover()).find(entry => entry.path === "general.launchAtStartup")?.writable).toBe(true);
      expect(f.reads()).toBe(reads); expect(f.writes).toHaveLength(0);
      f.adapter.read = async () => undefined;
      await expect(agent.queries.read("general.launchAtStartup")).rejects.toMatchObject({ code: "settings/unavailable" });
      expect((await agent.queries.read("general.language")).value).toBeDefined();
      f.adapter.read = async () => { throw { code: "settings/unavailable", message: "PRIVATE OS FAILURE" }; };
      await expect(agent.queries.snapshot({ section: "general" })).rejects.toMatchObject({ code: "settings/unavailable" });
      Reflect.deleteProperty(f.dom.window, "__TAURI_INTERNALS__");
      expect((await agent.queries.discover()).find(entry => entry.path === "general.launchAtStartup")?.writable).toBe(false);
      await expect(agent.commands.update([{ path: "general.launchAtStartup", value: true }])).rejects.toMatchObject({ code: "ui/unavailable" });
      await expect(desktopStartup.read()).rejects.toMatchObject({ code: "ui/unavailable" });
    } finally { f.close(); }
  });

  test("authorized plugin and Agent writes await durable native results; later deltas never restore stale OS settings", async () => {
    const f = environment();
    const actor = buildPluginContext({ id: "startup-test", name: "Startup", version: "1", schemaVersion: 1,
      permissions: [], requires: {}, settingsAccess: { write: ["general.launchAtStartup"] } }, "1", []);
    actor.lifecycle.promote();
    try {
      await f.initialize();
      const gate = Promise.withResolvers<void>(); f.adapter.persist = () => gate.promise;
      let settled = false;
      const write = actor.context.domains.settings.commands.update([{ path: "general.launchAtStartup", value: true }]).then(value => { settled = true; return value; });
      await tick(); expect(settled).toBe(false); expect(f.actual()).toBe(false);
      expect(f.writes).toHaveLength(1);
      gate.resolve(); await write; expect(f.actual()).toBe(true);
      f.external(false); f.adapter.persist = async () => {};
      const agent = createSettingsDomain("agent");
      await agent.commands.update([{ path: "general.language", value: "fr" }]);
      expect(f.actual()).toBe(false);
      expect(JSON.parse(f.disk.get(GENERAL_SETTINGS_KEY)!)).toMatchObject({ language: "fr", launchAtStartup: false });
      f.adapter.persist = async () => { throw { code: "db/locked", message: "PRIVATE DATABASE FAILURE" }; };
      await expect(agent.commands.update([{ path: "general.launchAtStartup", value: true }])).rejects.toMatchObject({ code: "db/locked" });
      expect((await agent.queries.read("general.launchAtStartup")).value).toBe(false);
      expect(JSON.parse(localKV.getItem(GENERAL_SETTINGS_KEY)!).launchAtStartup).toBe(false);
      f.adapter.persist = async () => {};
      await agent.commands.update([{ path: "general.startView", value: "resume" }]);
      expect(f.actual()).toBe(false);
      actor.lifecycle.stop();
      expect(() => actor.context.domains.settings.commands.update([{ path: "general.launchAtStartup", value: true }])).toThrow();
    } finally { actor.lifecycle.stop(); f.close(); }
  });

  test("abort during native status read prevents a queued mutation from dispatching", async () => {
    const f = environment();
    try {
      await f.initialize();
      const status = Promise.withResolvers<boolean>(), controller = new AbortController();
      f.adapter.read = () => status.promise;
      const write = createSettingsDomain("agent").commands.update([{ path: "general.launchAtStartup", value: true }], controller.signal).catch(error => error);
      await tick(); controller.abort(); status.resolve(false);
      expect((await write).name).toBe("AbortError"); expect(f.writes).toHaveLength(0);
    } finally { f.close(); }
  });

  test("mounted general settings use actual state, prevent duplicate writes, refresh on focus and localize failures", async () => {
    const f = environment(), root = createRoot(f.dom.window.document.getElementById("root")!);
    const toggle = () => f.dom.window.document.querySelector<HTMLButtonElement>('[role=switch][aria-label="Launch at startup"]')!;
    try {
      await f.initialize(); await initI18n("en"); f.external(true);
      await act(async () => { root.render(<StrictMode><ToastProvider><GeneralPanel /></ToastProvider></StrictMode>); });
      expect(toggle()?.getAttribute("aria-checked")).toBe("true");
      const gate = Promise.withResolvers<void>(); f.adapter.persist = () => gate.promise;
      await act(async () => { toggle().click(); toggle().click(); await tick(); });
      expect(toggle().disabled).toBe(true); expect(f.writes).toHaveLength(1);
      await act(async () => { gate.resolve(); await tick(); });
      expect(toggle().getAttribute("aria-checked")).toBe("false");
      f.adapter.persist = async () => { throw { code: "settings/unavailable", message: "PRIVATE WRITE FAILURE" }; };
      await act(async () => { toggle().click(); await tick(); });
      expect(toggle().getAttribute("aria-checked")).toBe("false");
      expect(f.dom.window.document.body.textContent).not.toContain("PRIVATE WRITE FAILURE");
      expect(f.dom.window.document.querySelector('[role=status]')?.textContent).toContain("Settings could not be read");
      f.external(true);
      await act(async () => { f.dom.window.dispatchEvent(new f.dom.window.Event("focus")); await tick(); });
      expect(toggle().getAttribute("aria-checked")).toBe("true");
      f.adapter.read = async () => { throw { code: "settings/unavailable", message: "PRIVATE READ FAILURE" }; };
      await act(async () => { f.dom.window.dispatchEvent(new f.dom.window.Event("focus")); await tick(); });
      expect(toggle().disabled).toBe(true);
      expect(f.dom.window.document.body.textContent).not.toContain("PRIVATE READ FAILURE");
      expect(f.dom.window.document.querySelector('[role=alert]')).not.toBeNull();
      const retry = [...f.dom.window.document.querySelectorAll("button")].find(button => button.textContent?.includes("Try again"))!;
      expect(retry).toBeDefined();
      f.adapter.read = async () => false;
      await act(async () => { retry.click(); await tick(); });
      expect(toggle().disabled).toBe(false);
      expect(toggle().getAttribute("aria-checked")).toBe("false");
    } finally { await act(async () => { root.unmount(); }); f.close(); }
  });

  test("shared disabled controls reject both button and label clicks", async () => {
    const f = environment(), root = createRoot(f.dom.window.document.getElementById("root")!);
    let changes = 0;
    try {
      await act(async () => { root.render(<><Toggle label="Disabled toggle" checked={false} disabled onChange={() => changes++} />
        <ChoiceGroup value="a" options={[{ value: "a", label: "Choice A" }]} disabled onChange={() => changes++} /></>); });
      await act(async () => {
        for (const button of f.dom.window.document.querySelectorAll("button")) button.click();
        [...f.dom.window.document.querySelectorAll("span")].find(span => span.textContent === "Disabled toggle")!.click();
      });
      expect(changes).toBe(0);
    } finally { await act(async () => { root.unmount(); }); f.close(); }
  });
} else {
  test("isolated native startup domain, permission and mounted control contracts", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, DESKTOP_STARTUP_CASE: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("5 pass");
  }, 30_000);
}
