import { expect, test } from "bun:test";
import type { MemoryPageQuery, MemoryRecord, PluginCommand, PluginContext, PluginDetailView, PluginFormView, PluginListView, PluginModule } from "@read-aware/plugin-types";
import { memories } from "../src/views";

function fixture() {
  let revision = `mpg1:${"a".repeat(64)}`;
  const rows: MemoryRecord[] = Array.from({ length: 105 }, (_, index) => ({ id: `m${index}`, scope: "user", kind: "fact",
    content: `Memory ${index}`, importance: 0.5, evidenceCount: 1, createdAt: "now", updatedAt: "now" }));
  const queries: MemoryPageQuery[] = [], commands = new Map<string, PluginCommand>();
  const ctx = { locale: "en", domains: { reading: { commands: {} }, library: {}, conversations: {}, memory: { queries: {
    page: async (query: MemoryPageQuery) => {
      queries.push(structuredClone(query));
      if (query.expectedRevision !== undefined && query.expectedRevision !== revision) throw Object.assign(Error("changed"), { code: "memory/conflict" });
      const selected = rows.filter(row => query.scopes.includes(row.scope) && (!query.query || row.content.includes(query.query)));
      const offset = query.offset ?? 0, end = Math.min(selected.length, offset + (query.limit ?? 20));
      return { items: selected.slice(offset, end), total: selected.length, offset, nextOffset: end < selected.length ? end : null, revision };
    },
  } } }, contributions: { commands: { register: (command: PluginCommand) => { commands.set(command.id, command); } }, headerActions: { register() {} } } } as unknown as PluginContext;
  return { ctx, rows, queries, commands, change: () => { revision = `mpg1:${"b".repeat(64)}`; } };
}

test("compiled Memory Desk traverses every page beyond 100 and keeps one result revision", async () => {
  const f = fixture(), built = await Bun.build({ entrypoints: [new URL("../src/index.ts", import.meta.url).pathname], target: "browser" });
  expect(built.success).toBe(true);
  const plugin = (await import(`data:text/javascript;base64,${Buffer.from(await built.outputs[0]!.text()).toString("base64")}`)).default as PluginModule;
  await plugin.activate(f.ctx);
  const root = (await f.commands.get("open")!.run())!.view as PluginListView;
  let view = (await root.items.find(item => item.id === "user")!.onSelect!())!.view as PluginListView;
  const ids: string[] = [];
  for (;;) {
    expect(view.pagination!.pageCount).toBe(6);
    expect(view.searchable).not.toBe(true);
    ids.push(...view.items.map(item => item.id));
    if (!view.pagination!.onNext) break;
    view = (await view.pagination!.onNext())!.view as PluginListView;
  }
  expect(ids).toEqual(f.rows.map(row => row.id));
  expect(f.queries.map(query => query.offset)).toEqual([0, 20, 40, 60, 80, 100]);
  expect(f.queries.slice(1).every(query => query.expectedRevision === `mpg1:${"a".repeat(64)}`)).toBe(true);
  const previous = (await view.pagination!.onPrevious!())!.view as PluginListView;
  expect(previous.pagination!.page).toBe(5); expect(previous.items[0]!.id).toBe("m80");
});

test("changed results expose only refresh, which restarts without a stale revision; search starts a new query", async () => {
  const f = fixture(), first = await memories(f.ctx, "user") as PluginListView;
  f.change();
  const failed = (await first.pagination!.onNext!())!.view as PluginDetailView;
  expect(failed.content).toEqual([{ kind: "error", code: "memory/conflict" }]);
  expect(failed.actions?.map(action => action.id)).toEqual(["refresh"]);
  const fresh = (await failed.actions![0]!.run())!.view as PluginListView;
  expect(f.queries[f.queries.length - 1]).toEqual({ scopes: ["user"], query: undefined, limit: 20, offset: 0 });
  const form = (await fresh.actions!.find(action => action.id === "search")!.run())!.view as PluginFormView;
  const found = (await form.onSubmit({ query: "Memory 104" }))!.view as PluginListView;
  expect(found.items.map(item => item.id)).toEqual(["m104"]);
  expect(found.pagination!.onNext).toBeUndefined();
  expect(f.queries[f.queries.length - 1]).toEqual({ scopes: ["user"], query: "Memory 104", limit: 20, offset: 0 });
});
