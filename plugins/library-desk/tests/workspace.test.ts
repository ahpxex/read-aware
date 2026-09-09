import { expect, test } from "bun:test";
import type { PluginContext, PluginFormView, PluginListView, WorkspaceSnapshot } from "@read-aware/plugin-types";
import { workspaceView } from "../src/workspace";

function fixture() {
  const calls: unknown[] = []; let observe!: (state: WorkspaceSnapshot | null) => unknown, disposed = false;
  const state: WorkspaceSnapshot = { revision: 1, surface: "shelf", collectionId: null, settings: { open: false, section: null },
    search: { open: false, query: "book" }, selection: { active: true, total: 3, bookIds: ["a"], nextCursor: "a" } };
  const ctx = { locale: "en", domains: { library: { queries: { collections: { list: async () => [{ id: "c", name: "Collection" }] } } } }, services: { ui: {
    publishView: async (_channel: unknown, update: unknown) => { calls.push(update); },
    workspace: { snapshot: async () => state, navigate: async (target: unknown) => { calls.push(target); return { status: "completed", snapshot: state }; },
      observe: (_query: unknown, handler: typeof observe) => { observe = handler; return { dispose() { disposed = true; } }; } },
  } } } as unknown as PluginContext;
  return { ctx, state, calls, observe: (s: WorkspaceSnapshot | null) => observe(s), get disposed() { return disposed; } };
}
test("mixed-collection selection requires an explicit group choice and passes only visible IDs", async () => {
  const f = fixture();
  const base = { format: "epub" as const, starred: false, addedAt: "2026-09-09", updatedAt: "2026-09-09", collectionId: null };
  const view = await workspaceView(f.ctx, [{ ...base, id: "a", title: "A" }, { ...base, id: "b", title: "B", collectionId: "c" }]) as PluginListView;
  expect(f.calls.length).toBe(0); expect(view.items.length).toBe(2);
  const result = await view.items[1].onSelect!();
  expect(f.calls).toEqual([{ surface: "shelf", collectionId: "c", selection: { active: true, bookIds: ["b"] } }]);
  expect(result?.close).toBe(true);
});
test("workspace composes observed count, bounded snapshot, search form, and lifetime cleanup", async () => {
  const f = fixture(), view = await workspaceView(f.ctx);
  const subscription = await view.live!.subscribe({ id: "owned" } as never);
  await f.observe({ ...f.state, selection: { ...f.state.selection, total: 4 } });
  expect(f.calls[0]).toMatchObject({ revision: 1, view: { title: "Workspace · Selected: 4" } });
  const form = (await (view as PluginListView).actions!.find(a => a.id === "search")!.run())!.view as PluginFormView;
  await form.onSubmit({ query: "find a book" }); expect(f.calls[1]).toEqual({ surface: "search", query: "find a book" });
  subscription.dispose(); expect(f.disposed).toBe(true); await f.observe(f.state); expect(f.calls.length).toBe(2);
});
test("failed navigation keeps the view open and preserves the error", async () => {
  const f = fixture(), error = new Error("navigation failed");
  f.ctx.services.ui.workspace!.navigate = async () => { throw error; };
  const view = await workspaceView(f.ctx) as PluginListView;
  await expect(Promise.resolve().then(() => view.items[0].onSelect!())).rejects.toBe(error);
});
