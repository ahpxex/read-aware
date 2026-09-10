import { expect, test } from "bun:test";
import type { PluginContext, PluginListView, PluginView, PluginViewUpdate, BookTextSearch, BookTextHit } from "@read-aware/plugin-types";
import { textSearchForm } from "./search-views";

function context() {
  const calls: BookTextSearch[] = [];
  const updates: PluginViewUpdate[] = [];
  const ctx = { locale: "en", services: { ui: { publishView: async (_channel: unknown, update: PluginViewUpdate) => {
    updates.push(update); return { status: "applied" };
  } } }, domains: { library: { queries: { books: {
    list: async () => [{ id: "a", title: "A book" }],
    searchText: async (input: BookTextSearch) => { calls.push(input); return [{ bookId: "a", chapterIndex: 0, offset: 1, snippet: "alpha beta", match: "partial" }]; },
  } } } } } as unknown as PluginContext;
  return { ctx, calls, updates };
}
async function mount(view: PluginView, id = "channel") {
  const subscription = await view.live!.subscribe({ id });
  await Bun.sleep(0);
  return subscription;
}

test("search form validates, preserves scope and composes host results into selectable snippets", async () => {
  const { ctx, calls, updates } = context();
  const form = textSearchForm(ctx, "a");
  expect(await form.onSubmit({ queries: " " })).toHaveProperty("fieldErrors.queries");
  expect(await form.onSubmit({ queries: Array(13).fill("alpha").join("\n") })).toHaveProperty("fieldErrors.queries");
  expect(calls).toEqual([]);
  const result = await form.onSubmit({ queries: " alpha\n beta\n" });
  expect(calls).toEqual([]);
  expect(result!.view).toMatchObject({ kind: "blocks", blocks: [{ kind: "progress", value: null }] });
  await mount(result!.view!);
  expect(calls).toEqual([{ queries: ["alpha", "beta"], bookId: "a", limit: 40 }]);
  const view = updates[updates.length - 1]!.view as PluginListView;
  expect(view.items[0]).toMatchObject({ title: "A book", subtitle: "Partial · 1" });
  expect(await view.items[0]!.onSelect!()).toMatchObject({ view: { content: [{ kind: "text", text: "alpha beta" }] } });
  await mount((await textSearchForm(ctx).onSubmit({ queries: "alpha" }))!.view!, "shelf");
  expect(calls[1]?.bookId).toBeUndefined();
});

test("failed host search renders a stable error instead of false no-matches, and can be retried", async () => {
  const { ctx, updates } = context();
  const failure = Object.assign(Error("injected private storage failure"), { code: "db/locked" });
  ctx.domains.library!.queries.books.searchText = async () => { throw failure; };
  await mount((await textSearchForm(ctx).onSubmit({ queries: "alpha" }))!.view!);
  const error = updates[updates.length - 1]!.view;
  expect(error).toMatchObject({ kind: "blocks", blocks: [{ kind: "error", code: "db/locked" }, { kind: "actions" }] });
  expect(JSON.stringify(error)).not.toContain("private");
  if (error.kind !== "blocks" || error.blocks[1].kind !== "actions") throw new Error("Expected retry");
  const retry = await error.blocks[1].actions[0].run();
  expect(retry!.navigation).toBe("replace");
  ctx.domains.library!.queries.books.searchText = async () => [];
  await mount(retry!.view!, "retry");
  expect(updates[updates.length - 1]!.view).toMatchObject({ kind: "list", emptyText: "No matches in the searched index" });
});

test("cancelled queries ignore late results and do not start a book metadata read", async () => {
  const { ctx, updates } = context();
  let signal: AbortSignal | undefined, metadataReads = 0;
  let resolve!: (hits: BookTextHit[]) => void;
  ctx.domains.library!.queries.books.searchText = (_input, options) => {
    signal = options!.signal;
    return new Promise(done => { resolve = done; });
  };
  ctx.domains.library!.queries.books.list = async () => { metadataReads++; return []; };
  const task = (await textSearchForm(ctx).onSubmit({ queries: "alpha" }))!.view!;
  await mount(task);
  if (task.kind !== "blocks" || task.blocks[0].kind !== "progress") throw new Error("Expected progress");
  await task.blocks[0].cancel!.run();
  expect(signal!.aborted).toBe(true);
  expect(updates[updates.length - 1]!.view).toMatchObject({ emptyText: "Search cancelled" });
  const count = updates.length;
  resolve([{ bookId: "a", chapterIndex: 0, offset: 0, snippet: "alpha", match: "exact" }]);
  await Bun.sleep(0);
  expect(updates).toHaveLength(count);
  expect(metadataReads).toBe(0);
});

test("closing during result metadata loading aborts the query signal and never publishes a late view", async () => {
  const { ctx, updates } = context();
  let signal: AbortSignal | undefined, finish!: () => void;
  ctx.domains.library!.queries.books.searchText = async (_input, options) => { signal = options!.signal; return []; };
  ctx.domains.library!.queries.books.list = () => new Promise(resolve => { finish = () => resolve([]); });
  const task = (await textSearchForm(ctx, "a").onSubmit({ queries: "alpha" }))!.view!;
  const subscription = await mount(task);
  subscription.dispose();
  await task.onClose!({ reason: "back" });
  expect(signal!.aborted).toBe(true);
  const count = updates.length;
  finish();
  await Bun.sleep(0);
  expect(updates).toHaveLength(count);
  await mount(task, "restored");
  expect(updates[updates.length - 1]!.view).toMatchObject({ emptyText: "Search cancelled" });
});

test("terminal failures have no retry action and never expose raw details", async () => {
  const { ctx, updates } = context();
  ctx.domains.library!.queries.books.searchText = async () => { throw new Error("PRIVATE"); };
  await mount((await textSearchForm(ctx).onSubmit({ queries: "alpha" }))!.view!);
  expect(updates[updates.length - 1]!.view).toMatchObject({ kind: "blocks", blocks: [{ kind: "error", code: "library/content-unavailable" }] });
  expect(JSON.stringify(updates)).not.toContain("PRIVATE");
});
