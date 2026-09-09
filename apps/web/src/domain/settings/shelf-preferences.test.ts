import { beforeEach, expect, test } from "bun:test";
import { getDefaultStore } from "jotai";
import { shelfSelectionAtom, shelfViewAtom } from "../../state/ui";
import { DEFAULT_SHELF_VIEW, SHELF_VIEW_KEY, getShelfView } from "../../features/shelf/lib/shelf-view";
import { localKV } from "../../platform/local-store";
import { createSettingsDomain } from "./domain";

const disk = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => disk.get(key) ?? null, setItem: (key: string, value: string) => disk.set(key, value),
  removeItem: (key: string) => disk.delete(key), key: (index: number) => [...disk.keys()][index] ?? null, get length() { return disk.size; },
} });
const store = getDefaultStore();
beforeEach(async () => { await localKV.setItemAsync(SHELF_VIEW_KEY, JSON.stringify(DEFAULT_SHELF_VIEW)); });
test("Agent and scoped plugin discover the same real shelf options", async () => {
  const agent = await createSettingsDomain("agent").queries.snapshot({ section: "shelf" });
  const plugin = await createSettingsDomain("plugin:shelf", { read: ["shelf.*"] }).queries.snapshot();
  expect(plugin.settings).toEqual(agent.settings);
  expect(agent.settings.map(setting => [setting.path, setting.options?.map(option => option.value), setting.supportedTargets])).toEqual([
    ["shelf.layout", ["grid", "list"], ["global"]], ["shelf.group", ["none", "status", "author", "format"], ["global"]],
    ["shelf.sort", ["recent", "added", "title", "author", "progress"], ["global"]],
  ]);
});
test("two actors merge queued edits into live shelf state without touching selection", async () => {
  store.set(shelfSelectionAtom, { active: true, ids: ["keep"] });
  const a = createSettingsDomain("agent").commands.update([{ path: "shelf.layout", value: "list" }]);
  const b = createSettingsDomain("plugin:shelf", { write: ["shelf.group", "shelf.sort"] }).commands.update([
    { path: "shelf.group", value: "author" }, { path: "shelf.sort", value: "title" },
  ]);
  await a; await b;
  expect(store.get(shelfViewAtom)).toEqual({ layout: "list", group: "author", sort: "title" });
  expect(getShelfView()).toEqual(store.get(shelfViewAtom));
  expect(store.get(shelfSelectionAtom)).toEqual({ active: true, ids: ["keep"] });
});
test("snapshot never promotes discovery permission into value access", async () => {
  const denied = await createSettingsDomain("plugin:none").queries.snapshot();
  expect(denied.settings).toEqual([]);
  expect(denied.overrides).toEqual([]);
  const discoveryOnly = createSettingsDomain("plugin:discover", { discover: ["shelf.*"] });
  expect(await discoveryOnly.queries.discover({ section: "shelf" })).toHaveLength(3);
  expect((await discoveryOnly.queries.snapshot()).settings).toEqual([]);
  const scoped = await createSettingsDomain("plugin:one", { read: ["shelf.layout"] }).queries.snapshot();
  expect(scoped.settings.map(setting => setting.path)).toEqual(["shelf.layout"]);
  expect(scoped.overrides).toEqual([]);
});
test("invalid, unauthorized and per-book writes leave the shelf unchanged", async () => {
  const agent = createSettingsDomain("agent");
  await expect(agent.commands.update([{ path: "shelf.layout", value: "list" }, { path: "shelf.sort", value: "random" }])).rejects.toThrow();
  await expect(agent.commands.update([{ path: "shelf.layout", value: "list", target: { kind: "book", bookId: "one" } }])).rejects.toThrow();
  await expect(createSettingsDomain("plugin:shelf").commands.update([{ path: "shelf.layout", value: "list" }])).rejects.toThrow();
  expect(store.get(shelfViewAtom)).toEqual(DEFAULT_SHELF_VIEW);
});
test("external persisted writes refresh the atom even without a mounted shelf", async () => {
  await localKV.setItemAsync(SHELF_VIEW_KEY, JSON.stringify({ layout: "list", group: "format", sort: "progress" }));
  expect(store.get(shelfViewAtom)).toEqual({ layout: "list", group: "format", sort: "progress" });
});
