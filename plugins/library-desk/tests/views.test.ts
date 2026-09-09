import { expect, test } from "bun:test";
import type { PluginContext, PluginDetailView, PluginListView, PluginViewContent } from "@read-aware/plugin-types";
import { libraryDesk } from "../src/views";

test("selection publishes without navigation; review freezes IDs; pending cleanup exposes a safe retry", async () => {
  const removed: string[][] = [], retries: string[][] = [];
  let latest: PluginViewContent | undefined;
  const books = [{ id: "a", title: "Alpha" }, { id: "b", title: "Beta" }];
  const ctx = { locale: "en", domains: { library: {
    queries: { books: { list: async () => books } }, commands: { books: {
      removeMany: async (ids: string[]) => { removed.push([...ids]); return { bookIds: ids, committed: true, files: { status: "pending", errorCode: "fs/permission" } }; },
      retryRemovalCleanup: async (ids: string[]) => { retries.push([...ids]); return { bookIds: ids, files: { status: "released" } }; },
    } },
  } }, services: { ui: { publishView: async (_channel: unknown, update: { view: PluginViewContent }) => { latest = update.view; return { status: "applied" }; } } } } as unknown as PluginContext;
  const root = await libraryDesk(ctx);
  const resource = await root.live!.subscribe({ id: "test" } as never);
  await (latest as PluginListView).items[0].onSelect!();
  expect(removed).toEqual([]);
  expect((latest as PluginListView).items[0].accessories?.[0]).toMatchObject({ icon: "check" });
  const reviewed = await (latest as PluginListView).actions!.find(action => action.id === "review")!.run();
  expect((reviewed!.view as PluginDetailView).content[1]).toEqual({ kind: "text", text: "1. Alpha\n" });
  await (latest as PluginListView).items[1].onSelect!();
  const result = await (reviewed!.view as PluginDetailView).actions![0].run();
  expect(removed).toEqual([["a"]]);
  expect(result!.navigation).toBe("reset");
  const retried = await (result!.view as PluginDetailView).actions!.find(action => action.id === "retry")!.run();
  expect(retries).toEqual([["a"]]);
  expect((retried!.view as PluginDetailView).actions!.some(action => action.id === "retry")).toBe(false);
  resource.dispose();
});

test("late refreshes cannot replace a newer snapshot or publish after view disposal", async () => {
  const pending: Array<(books: Array<{ id: string; title: string }>) => void> = [];
  let calls = 0, publishes = 0;
  let latest: PluginViewContent | undefined;
  const ctx = { locale: "en", domains: { library: { queries: { books: {
    list: () => ++calls <= 2 ? Promise.resolve([]) : new Promise(resolve => pending.push(resolve)),
  } }, commands: { books: {} } } }, services: { ui: {
    publishView: async (_channel: unknown, update: { view: PluginViewContent }) => { ++publishes; latest = update.view; },
  } } } as unknown as PluginContext;
  const root = await libraryDesk(ctx);
  const resource = await root.live!.subscribe({ id: "test" } as never);
  const refresh = (latest as PluginListView).actions![0].run;
  const older = refresh(), newer = refresh();
  pending[1]([{ id: "new", title: "New" }]); await newer;
  pending[0]([{ id: "old", title: "Old" }]); await older;
  expect((latest as PluginListView).items.map(item => item.id)).toEqual(["new"]);
  const before = publishes, retired = refresh();
  resource.dispose(); pending[2]([{ id: "late", title: "Late" }]); await retired;
  expect(publishes).toBe(before);
});
