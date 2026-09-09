import { beforeEach, expect, test } from "bun:test";
import { getDefaultStore } from "jotai";
import { shortcutBindingsAtom } from "../../state/ui";
import { localKV } from "../../platform/local-store";
import { SHORTCUT_BINDINGS_KEY } from "../../features/settings/lib/shortcut-bindings";
import { createSettingsDomain } from "./domain";

const disk = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => disk.get(key) ?? null, setItem: (key: string, value: string) => disk.set(key, value),
  removeItem: (key: string) => disk.delete(key), key: (index: number) => [...disk.keys()][index] ?? null, get length() { return disk.size; },
} });
beforeEach(async () => { await localKV.setItemAsync(SHORTCUT_BINDINGS_KEY, "{}"); });
test("both actors read current bindings but grants control actual writability", async () => {
  const plugin = createSettingsDomain("plugin:shortcuts", { read: ["shortcuts.search"] });
  const snapshot = await plugin.queries.snapshot({ section: "shortcuts" });
  expect(snapshot.settings).toHaveLength(1);
  expect(snapshot.settings[0]).toMatchObject({ path: "shortcuts.search", value: ["mod", "k"], writable: false,
    shortcut: { defaultBinding: ["mod", "k"], overridden: false, conflicts: [] } });
  expect((await plugin.queries.discover())[0]?.shortcut).toBeUndefined();
  await expect(plugin.commands.update([{ path: "shortcuts.search", value: ["mod", "p"] }])).rejects.toThrow("not permitted");
});
test("atomic swaps reach the live atom; null resets instead of explicitly storing the default", async () => {
  const domain = createSettingsDomain("agent");
  await domain.commands.update([{ path: "shortcuts.search", value: ["mod", ","] }, { path: "shortcuts.settings", value: ["mod", "k"] }]);
  expect(getDefaultStore().get(shortcutBindingsAtom)).toEqual({ search: { mod: true, key: "," }, settings: { mod: true, key: "k" } });
  await expect(domain.commands.update([{ path: "shortcuts.search", value: null }])).rejects.toMatchObject({ code: "settings/shortcut-conflict" });
  await domain.commands.update([{ path: "shortcuts.search", value: null }, { path: "shortcuts.settings", value: null }]);
  expect(getDefaultStore().get(shortcutBindingsAtom)).toEqual({});
});
test("conflicts and malformed arrays reject the entire mixed-settings transaction", async () => {
  const domain = createSettingsDomain("agent");
  const before = await domain.queries.read("shelf.layout");
  for (const value of [["Escape"], ["mod", ","]]) {
    await expect(domain.commands.update([{ path: "shelf.layout", value: "list" }, { path: "shortcuts.search", value }])).rejects.toThrow();
  }
  expect(getDefaultStore().get(shortcutBindingsAtom)).toEqual({});
  expect((await domain.queries.read("shelf.layout")).value).toBe(before.value);
});
test("queued actors cannot allocate the same chord using stale snapshots", async () => {
  const agent = createSettingsDomain("agent");
  const plugin = createSettingsDomain("plugin:shortcuts", { write: ["shortcuts.settings"] });
  const first = agent.commands.update([{ path: "shortcuts.search", value: ["mod", "shift", "p"] }]);
  const second = plugin.commands.update([{ path: "shortcuts.settings", value: ["mod", "shift", "p"] }]).catch(error => error);
  await first; expect((await second).code).toBe("settings/shortcut-conflict");
  expect(getDefaultStore().get(shortcutBindingsAtom).settings).toBeUndefined();
});
test("external KV invalidation refreshes actual shortcut consumers without a mounted panel", async () => {
  await localKV.setItemAsync(SHORTCUT_BINDINGS_KEY, JSON.stringify({ search: { mod: true, key: "p" } }));
  expect(getDefaultStore().get(shortcutBindingsAtom).search).toEqual({ mod: true, key: "p" });
});
