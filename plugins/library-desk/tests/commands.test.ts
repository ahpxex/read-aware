import { expect, test } from "bun:test";
import type { HostCommandObservation, HostCommandReceipt, PluginContext, PluginDetailView, PluginListView, PluginViewUpdate } from "@read-aware/plugin-types";
import { commandsView, commandStrings } from "../src/commands";
const list = (view: PluginDetailView) => view.content[1] as PluginListView;

function fixture() {
  let receipt: HostCommandReceipt = { commandId: "layout-list", status: "completed", completed: ["settings", "workspace"] }, lists = 0;
  const calls: unknown[] = [];
  const ctx = { locale: "en", services: { ui: { commands: {
    list: async () => { lists++; return { version: 1, workspaceRevision: 7, commands: [
      { id: "layout-list", title: "List", enabled: true, checked: true },
      { id: "go-stats", title: "Statistics", enabled: false, unavailableReason: "reader-control" },
    ] }; }, execute: async (request: unknown) => { calls.push(request); return receipt; },
  } } } } as unknown as PluginContext;
  return { ctx, calls, set receipt(value: HostCommandReceipt) { receipt = value; }, get lists() { return lists; } };
}
test("command view uses host titles, checked and unavailable states, guarding actual execution", async () => {
  const f = fixture(), view = list(await commandsView(f.ctx));
  expect(view.items[0].accessories).toEqual([{ kind: "icon", icon: "check", label: "Selected" }]);
  expect(view.items[1].onSelect).toBeUndefined(); expect(view.items[1].subtitle).toBe("Reader control required");
  expect(await view.items[0].onSelect!()).toEqual({ close: true });
  expect(f.calls).toEqual([{ id: "layout-list", expectedWorkspaceRevision: 7 }]);
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) expect(commandStrings(locale)).toHaveLength(7);
});
test("partial commit stays open with localized host error and refresh, never automatically repeats the write", async () => {
  const f = fixture(); f.receipt = { commandId: "layout-list", status: "partial", completed: ["settings"], errorCode: "ui/superseded" };
  const view = list(await commandsView(f.ctx)), result = await view.items[0].onSelect!();
  expect(result?.close).not.toBe(true);
  const detail = result?.view as PluginDetailView;
  expect(detail.content).toContainEqual({ kind: "error", code: "ui/superseded" });
  const refreshed = await detail.actions![0].run();
  expect(list(refreshed?.view as PluginDetailView).items).toHaveLength(2); expect(f.lists).toBe(2); expect(f.calls).toHaveLength(1);
});
test("rejected navigation remains an action failure rather than success or an empty command list", async () => {
  const f = fixture(), error = new Error("probe"); f.ctx.services.ui.commands!.execute = async () => { throw error; };
  const view = list(await commandsView(f.ctx)); await expect(Promise.resolve(view.items[0].onSelect!())).rejects.toBe(error);
  f.ctx.services.ui.commands!.list = async () => { throw error; };
  await expect(commandsView(f.ctx)).rejects.toBe(error);
});

test("resource commands compose library pickers and pass only the chosen semantic ID", async () => {
  const f = fixture();
  f.ctx.domains = { library: { queries: { books: { list: async () => [{ id: "book", title: "Book" }] },
    collections: { list: async () => [{ id: "collection", name: "Collection" }] } } } } as never;
  f.ctx.services.ui.commands!.list = async () => ({ version: 1, workspaceRevision: 7, commands: [
    { id: "open-book", title: "Open book", enabled: true }, { id: "open-collection", title: "Open collection", enabled: true },
  ] } as never);
  const view = list(await commandsView(f.ctx));
  for (const [index, id, key, value] of [[0, "open-book", "bookId", "book"], [1, "open-collection", "collectionId", "collection"]] as const) {
    const picker = (await view.items[index].onSelect!())!.view as PluginListView;
    expect(picker.searchable).toBe(true); expect(picker.items).toHaveLength(1);
    await picker.items[0].onSelect!();
    expect(f.calls[f.calls.length - 1]).toEqual({ id, args: { [key]: value }, expectedWorkspaceRevision: 7 });
  }
});

test("live commands retain prior rows on error, disable stale actions, recover and retire", async () => {
  const f = fixture(), updates: PluginViewUpdate[] = [];
  let handler!: (state: HostCommandObservation) => unknown, disposed = 0;
  f.ctx.services.ui.commands!.observe = listener => { handler = listener; return { dispose() { disposed++; } }; };
  f.ctx.services.ui.publishView = async (_channel, update) => { updates.push(update); return { status: "applied" }; };
  const view = await commandsView(f.ctx), subscription = await view.live!.subscribe({ id: "channel" });
  const before = list(view).items[0];
  await handler({ revision: 1, status: "error", code: "db/locked" });
  const failed = updates[0].view as PluginDetailView;
  expect(failed.content[0]).toEqual({ kind: "group", blocks: [{ kind: "error", code: "db/locked" }] });
  expect(list(failed).items).toHaveLength(2); expect(list(failed).items[0].onSelect).toBeUndefined();
  const next = await f.ctx.services.ui.commands!.list(); next.workspaceRevision = 9;
  await handler({ revision: 2, status: "ready", snapshot: next });
  const recovered = updates[1].view as PluginDetailView;
  expect(recovered.content[0]).toEqual({ kind: "group", blocks: [] });
  await list(recovered).items[0].onSelect!(); expect(f.calls[0]).toEqual({ id: "layout-list", expectedWorkspaceRevision: 9 });
  await before.onSelect!(); expect(f.calls[1]).toEqual({ id: "layout-list", expectedWorkspaceRevision: 7 });
  subscription.dispose(); await handler({ revision: 3, status: "ready", snapshot: next });
  expect(disposed).toBe(1); expect(updates).toHaveLength(2);
});
