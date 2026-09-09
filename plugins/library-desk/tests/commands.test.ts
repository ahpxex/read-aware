import { expect, test } from "bun:test";
import type { HostCommandReceipt, PluginContext, PluginDetailView, PluginListView } from "@read-aware/plugin-types";
import { commandsView, commandStrings } from "../src/commands";

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
  const f = fixture(), view = await commandsView(f.ctx);
  expect(view.items[0].accessories).toEqual([{ kind: "icon", icon: "check", label: "Selected" }]);
  expect(view.items[1].onSelect).toBeUndefined(); expect(view.items[1].subtitle).toBe("Reader control required");
  expect(await view.items[0].onSelect!()).toEqual({ close: true });
  expect(f.calls).toEqual([{ id: "layout-list", expectedWorkspaceRevision: 7 }]);
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) expect(commandStrings(locale)).toHaveLength(7);
});
test("partial commit stays open with localized host error and refresh, never automatically repeats the write", async () => {
  const f = fixture(); f.receipt = { commandId: "layout-list", status: "partial", completed: ["settings"], errorCode: "ui/superseded" };
  const view = await commandsView(f.ctx), result = await view.items[0].onSelect!();
  expect(result?.close).not.toBe(true);
  const detail = result?.view as PluginDetailView;
  expect(detail.content).toContainEqual({ kind: "error", code: "ui/superseded" });
  const refreshed = await detail.actions![0].run();
  expect((refreshed?.view as PluginListView).items).toHaveLength(2); expect(f.lists).toBe(2); expect(f.calls).toHaveLength(1);
});
test("rejected navigation remains an action failure rather than success or an empty command list", async () => {
  const f = fixture(), error = new Error("probe"); f.ctx.services.ui.commands!.execute = async () => { throw error; };
  const view = await commandsView(f.ctx); await expect(Promise.resolve(view.items[0].onSelect!())).rejects.toBe(error);
  f.ctx.services.ui.commands!.list = async () => { throw error; };
  await expect(commandsView(f.ctx)).rejects.toBe(error);
});
