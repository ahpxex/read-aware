import { expect, test } from "bun:test";
import type { PluginContext, PluginDetailView, PluginFormView, PluginListView, PluginModule, PluginViewResult } from "@read-aware/plugin-types";
import { fontCatalog, fontsView } from "../src/fonts";

function fixture() {
  const queries: unknown[] = [], writes: unknown[] = [];
  let revision = 7, failure = false, writable = true;
  const ctx = { locale: "en", domains: { settings: { queries: {
    snapshot: async () => ({ settings: [
      { path: "reading.fontFamily", value: "system:Georgia", writable },
      { path: "appearance.contentTypography.fontFamily", value: null, writable },
      { path: "appearance.contentTypography.followReader", value: true, writable },
    ] }),
    options: async (query: { path: string; revision?: number; offset?: number }) => {
      queries.push(query);
      if (failure) throw Object.assign(Error("private font path"), { code: "fs/not-found" });
      if (query.revision !== undefined && query.revision !== revision) throw Object.assign(Error("changed"), { code: "settings/options-stale" });
      return { path: query.path, revision, offset: query.offset ?? 0, total: 3, nextOffset: query.offset ? null : 2,
        options: query.offset ? [{ value: "system:Last", label: "Last" }] : [{ value: null, label: "App font" }, { value: "system:Georgia", label: "Georgia" }] };
    },
  }, commands: { update: async (changes: unknown) => {
    if (failure) throw Object.assign(Error("write failed"), { code: "db/error" });
    writes.push(changes); return { changed: changes };
  } } } }, services: { storage: { collection: () => ({ list: async () => [] }) } } } as unknown as PluginContext;
  return { ctx, queries, writes, changeRevision: () => { revision++; }, fail: () => { failure = true; }, readonly: () => { writable = false; } };
}
const viewOf = (r: PluginViewResult) => r!.view as PluginListView;
async function action(view: PluginListView | PluginDetailView, id: string) { return (await view.actions!.find(a => a.id === id)!.run())!; }

test("font targets retain current values and read-only settings have no write controls", async () => {
  const f = fixture(), view = await fontsView(f.ctx);
  expect(view.items.map(i => i.subtitle)).toEqual(["system:Georgia", "App default"]);
  f.readonly(); const read = await fontsView(f.ctx);
  expect(read.items.every(i => !i.onSelect)).toBe(true);
  expect(read.actions!.map(a => a.id)).toEqual(["refresh"]);
});

test("catalog pagination uses exact returned offsets, global target and fixed revision", async () => {
  const f = fixture(), first = await fontCatalog(f.ctx, "reading.fontFamily", "geo");
  const next = viewOf(await first.pagination!.onNext!());
  expect(f.queries[1]).toEqual({ path: "reading.fontFamily", target: { kind: "global" }, search: "geo", offset: 2, limit: 40, revision: 7 });
  expect(next.items.map(i => i.title)).toEqual(["Last"]);
  await next.pagination!.onPrevious!(); expect(f.queries[2]).toMatchObject({ offset: 0, revision: 7 });
  f.changeRevision(); await expect(next.pagination!.onPrevious!()).rejects.toMatchObject({ code: "settings/options-stale" });
  await action(next, "refresh"); expect(f.queries[f.queries.length - 1]).toMatchObject({ offset: 0, revision: undefined });
});

test("font search reaches the host catalog rather than filtering only the current page", async () => {
  const f = fixture(), list = await fontCatalog(f.ctx, "reading.fontFamily");
  const form = (await action(list, "search")).view as PluginFormView;
  expect(await form.onSubmit({ query: "x".repeat(121) })).toHaveProperty("fieldErrors.query");
  expect(f.queries).toHaveLength(1);
  await form.onSubmit({ query: "  Georgia  " });
  expect(f.queries[1]).toMatchObject({ search: "Georgia", offset: 0, revision: undefined });
});

test("selection previews before applying; independent null font disables following in one command", async () => {
  const f = fixture(), list = await fontCatalog(f.ctx, "appearance.contentTypography.fontFamily");
  const preview = (await list.items[0]!.onSelect!())!.view as PluginDetailView;
  expect(f.writes).toHaveLength(0);
  await action(preview, "apply");
  expect(f.writes).toEqual([[
    { path: "appearance.contentTypography.fontFamily", value: null, target: { kind: "global" } },
    { path: "appearance.contentTypography.followReader", value: false, target: { kind: "global" } },
  ]]);
  const reader = await fontCatalog(f.ctx, "reading.fontFamily");
  await action((await reader.items[1]!.onSelect!())!.view as PluginDetailView, "apply");
  expect(f.writes[1]).toEqual([{ path: "reading.fontFamily", value: "system:Georgia", target: { kind: "global" } }]);
});

test("following is a binary setting; failures do not replace the preview with success", async () => {
  const f = fixture(), root = await fontsView(f.ctx);
  const form = (await action(root, "follow")).view as PluginFormView;
  expect(form.fields[0]).toMatchObject({ kind: "toggle", value: true });
  expect(await form.onSubmit({ follow: "false" })).toHaveProperty("fieldErrors.follow");
  await form.onSubmit({ follow: true });
  expect(f.writes[0]).toEqual([{ path: "appearance.contentTypography.followReader", value: true, target: { kind: "global" } }]);
  const list = await fontCatalog(f.ctx, "reading.fontFamily"), preview = (await list.items[1]!.onSelect!())!.view as PluginDetailView;
  f.fail(); await expect(action(preview, "apply")).rejects.toMatchObject({ code: "db/error" });
  await expect(fontCatalog(f.ctx, "reading.fontFamily")).rejects.toMatchObject({ code: "fs/not-found" });
  expect(f.writes).toHaveLength(1);
});

test("compiled command exposes the font catalog through production contribution callbacks", async () => {
  const f = fixture(); let run!: () => Promise<PluginViewResult>;
  Object.assign(f.ctx, { contributions: {
    commands: { register: (c: { run: typeof run }) => { run = c.run; return { dispose() {} }; } },
    headerActions: { register: () => ({ dispose() {} }) }, agentTools: { register: () => ({ dispose() {} }) },
  } });
  const plugin = (await import(new URL("../dist/main.js", import.meta.url).href)).default as PluginModule;
  await plugin.activate(f.ctx);
  const root = viewOf(await run()), fonts = viewOf(await action(root, "fonts"));
  const catalog = viewOf(await fonts.items[0]!.onSelect!());
  expect(catalog.items.map(i => i.title)).toEqual(["App font", "Georgia"]);
  expect(f.writes).toHaveLength(0);
});
