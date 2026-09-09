import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createSettingsDomain } from "../../../domain/settings/domain";
import { forwardKeyDownToApp } from "../../../platform/app-keydown";
import { usePluginCommandShortcuts } from "../../plugins/hooks/usePluginCommandShortcuts";
import { registerCommandContribution } from "../../plugins/state/plugin-store";
import type { PluginDisposable } from "@read-aware/plugin-types";
import { useGlobalShortcuts } from "./useGlobalShortcuts";

if (process.env.SHORTCUT_DISPATCH_CASE === "1") {
test("live native/global and plugin handlers arbitrate window and iframe events in either mount order", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div><input><iframe></iframe>", { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const owned: PluginDisposable[] = [];
  const calls: string[] = [];
  const add = (id: string, key: string, mod = true) => {
    const handle = registerCommandContribution({ key: `${id}:open`, pluginId: id, pluginName: id, id: "open", title: id,
      defaultShortcut: { mod, key }, run: () => { calls.push(id); } });
    owned.push(handle); return handle;
  };
  const press = (key: string, scope: "window" | "frame", target?: Element) => {
    const event = new dom.window.KeyboardEvent("keydown", { key, metaKey: true, cancelable: true, bubbles: true });
    if (scope === "frame") {
      const body = dom.window.document.querySelector("iframe")!.contentDocument!.body;
      body.dispatchEvent(event); forwardKeyDownToApp(event as unknown as KeyboardEvent);
    } else (target ?? dom.window).dispatchEvent(event);
    return event.defaultPrevented;
  };
  function Global() { useGlobalShortcuts({ onOpenSearch: () => calls.push("search"), onOpenSettings: () => calls.push("settings"), onNewConversation: () => calls.push("new"), onSelectPrimaryDestination: () => { calls.push("nav"); return true; } }); return null; }
  function Plugins() { usePluginCommandShortcuts(); return null; }
  const settings = createSettingsDomain("agent");
  try {
    for (const pluginFirst of [true, false]) {
      await act(async () => { root.render(pluginFirst ? <><Plugins /><Global /></> : <><Global /><Plugins /></>); });
      for (const scope of ["window", "frame"] as const) {
        calls.length = 0;
        expect(press("k", scope)).toBe(true); expect(calls).toEqual(["search"]);
        const conflict = add("conflict", "k");
        calls.length = 0;
        expect(press("k", scope)).toBe(true); expect(calls).toEqual([]);
        expect(press("k", "window", dom.window.document.querySelector("input")!)).toBe(true); expect(calls).toEqual([]);
        expect((await settings.queries.snapshot({ section: "shortcuts" })).settings.find(row => row.path === "shortcuts.search")?.shortcut?.conflicts).toEqual(["shortcuts.plugin.conflict%3Aopen"]);
        const restricted = createSettingsDomain("plugin:conflict", { read: ["shortcuts.plugin.conflict%3Aopen"] });
        expect((await restricted.queries.snapshot({ section: "shortcuts" })).settings[0]?.shortcut).toMatchObject({ available: true, conflicted: true, conflicts: [] });
        expect((await restricted.queries.discover({ section: "shortcuts" }))[0]?.shortcut).toBeUndefined();
        await settings.commands.update([{ path: "shortcuts.plugin.conflict%3Aopen", value: ["mod", "g"] }]);
        expect(press("g", scope)).toBe(true); expect(calls).toEqual(["conflict"]);
        calls.length = 0;
        const second = add("second", "g");
        expect(press("g", scope)).toBe(true); expect(calls).toEqual([]);
        second.dispose();
        // Disposal is effective before a React effect cleanup/rerender.
        expect(press("g", scope)).toBe(true); expect(calls).toEqual(["conflict"]);
        conflict.dispose(); calls.length = 0;
        expect(press("g", scope)).toBe(false); expect(calls).toEqual([]);
        expect(press("k", scope)).toBe(true); expect(calls).toEqual(["search"]);
        await settings.commands.update([{ path: "shortcuts.plugin.conflict%3Aopen", value: null }]);
      }
    }
  } finally {
    for (const handle of owned.reverse()) handle.dispose();
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
} else {
  test("isolated shortcut dispatch integration", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], { env: { ...process.env, SHORTCUT_DISPATCH_CASE: "1" }, stdout: "ignore", stderr: "pipe" });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("1 pass");
  }, 30_000);
}
