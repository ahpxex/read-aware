import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { getDefaultStore } from "jotai";
import { ToastProvider } from "@read-aware/ui";
import { createSettingsDomain } from "../../../domain/settings/domain";
import { initI18n } from "../../../i18n";
import { localKV } from "../../../platform/local-store";
import { shortcutBindingsAtom } from "../../../state/ui";
import { SHORTCUT_BINDINGS_KEY } from "../lib/shortcut-bindings";
import { useShortcutPreferences } from "./useShortcutPreferences";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
if (process.env.SHORTCUT_EDITOR_CASE === "1") {
test("native editor awaits durable writes, shares actor ordering, and keeps failed changes visible", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const disk = new Map<string, string>();
  const pending: Array<{ entries: [string, string][]; resolve(): void; reject(error: unknown): void }> = [];
  let hold = false;
  Object.assign(dom.window, { __TAURI_INTERNALS__: { invoke: (command: string, args: { entries: [string, string][]; key: string; value: string }) => {
    if (command === "local_device_get") return Promise.resolve({ deviceId: "shortcut-editor", lastHlcWallMs: null, lastHlcCounter: null });
    if (command !== "set_kv" && command !== "set_kv_batch") return Promise.resolve();
    const entries = command === "set_kv" ? [[args.key, args.value] as [string, string]] : args.entries;
    return new Promise<void>((resolve, reject) => {
      const commit = () => { for (const [key, value] of entries) disk.set(key, value); resolve(); };
      if (hold) pending.push({ entries, resolve: commit, reject }); else commit();
    });
  } } });
  const root = createRoot(dom.window.document.getElementById("root")!);
  let editor!: ReturnType<typeof useShortcutPreferences>;
  function Harness() { editor = useShortcutPreferences(); return null; }
  const user = createSettingsDomain("user");
  const events: unknown[] = [];
  const unsubscribe = user.events.subscribe(event => events.push(event));
  try {
    await initI18n("en");
    await localKV.setItemAsync(SHORTCUT_BINDINGS_KEY, "{}");
    await act(async () => { root.render(<ToastProvider><Harness /></ToastProvider>); });
    hold = true;
    let save!: Promise<boolean>;
    await act(async () => { save = editor.rebind("search", { mod: true, shift: true, key: "p" }); await tick(); });
    expect(editor.busy).toBe(true);
    expect(events).toEqual([]);
    expect(await editor.reset("search")).toBe(false);
    const other = createSettingsDomain("plugin:editor-test", { write: ["shortcuts.settings"] }).commands.update([
      { path: "shortcuts.settings", value: ["mod", "shift", "g"] },
    ]);
    await act(async () => { pending.shift()!.resolve(); expect(await save).toBe(true); await tick(); });
    expect(editor.busy).toBe(false);
    expect(pending).toHaveLength(1);
    pending.shift()!.resolve(); await other;
    expect(events).toMatchObject([{ origin: "user" }, { origin: "plugin:editor-test" }]);
    expect(getDefaultStore().get(shortcutBindingsAtom)).toEqual({
      search: { mod: true, shift: true, key: "p" }, settings: { mod: true, shift: true, key: "g" },
    });

    // A native failure must release the busy state, preserve persisted overrides,
    // notify the user, and publish no success event.
    const committed = disk.get(SHORTCUT_BINDINGS_KEY);
    await act(async () => { save = editor.reset("search"); await tick(); });
    expect(editor.busy).toBe(true);
    await act(async () => {
      pending.shift()!.reject({ code: "db/locked", message: "private native lock detail" });
      expect(await save).toBe(false);
    });
    expect(editor.busy).toBe(false);
    expect(disk.get(SHORTCUT_BINDINGS_KEY)).toBe(committed);
    expect(getDefaultStore().get(shortcutBindingsAtom).search).toEqual({ mod: true, shift: true, key: "p" });
    expect(events).toHaveLength(2);
    expect(dom.window.document.querySelector('[role="status"]')?.textContent).toBeTruthy();
    expect(dom.window.document.body.textContent).not.toContain("private native lock detail");

    hold = false;
    await localKV.setItemAsync(SHORTCUT_BINDINGS_KEY, JSON.stringify({ search: { mod: true, key: "p" }, "plugin:retired:open": { mod: true, key: "g" } }));
    hold = true;
    await act(async () => { save = editor.resetAll(); await tick(); });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.entries).toEqual([[SHORTCUT_BINDINGS_KEY, "{}"]]);
    await act(async () => { pending.shift()!.resolve(); expect(await save).toBe(true); });
    expect(getDefaultStore().get(shortcutBindingsAtom)).toEqual({});
    expect(disk.get(SHORTCUT_BINDINGS_KEY)).toBe("{}");
    expect(events.at(-1)).toMatchObject({ origin: "user", changes: [
      { path: "shortcuts.search", value: null }, { path: "shortcuts.plugin.retired%3Aopen", value: null },
    ] });
  } finally {
    hold = false;
    for (const item of pending.splice(0)) item.resolve();
    await act(async () => { await tick(); root.unmount(); });
    unsubscribe(); dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
} else {
  test("isolated native shortcut editor contract", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, SHORTCUT_EDITOR_CASE: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("1 pass");
  }, 30_000);
}
