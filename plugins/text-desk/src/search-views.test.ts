import { expect, test } from "bun:test";
import type { PluginContext, PluginListView, BookTextSearch } from "@read-aware/plugin-types";
import { textSearchForm } from "./search-views";

function context() {
  const calls: BookTextSearch[] = [];
  const ctx = { locale: "en", domains: { library: { queries: { books: {
    list: async () => [{ id: "a", title: "A book" }],
    searchText: async (input: BookTextSearch) => { calls.push(input); return [{ bookId: "a", chapterIndex: 0, offset: 1, snippet: "alpha beta", match: "partial" }]; },
  } } } } } as unknown as PluginContext;
  return { ctx, calls };
}

test("search form validates, preserves scope and composes host results into selectable snippets", async () => {
  const { ctx, calls } = context();
  const form = textSearchForm(ctx, "a");
  expect(await form.onSubmit({ queries: " " })).toHaveProperty("fieldErrors.queries");
  expect(await form.onSubmit({ queries: Array(13).fill("alpha").join("\n") })).toHaveProperty("fieldErrors.queries");
  expect(calls).toEqual([]);
  const result = await form.onSubmit({ queries: " alpha\n beta\n" });
  expect(calls).toEqual([{ queries: ["alpha", "beta"], bookId: "a", limit: 40 }]);
  const view = result!.view as PluginListView;
  expect(view.items[0]).toMatchObject({ title: "A book", subtitle: "Partial · 1" });
  expect(await view.items[0]!.onSelect!()).toMatchObject({ view: { content: [{ kind: "text", text: "alpha beta" }] } });
  await textSearchForm(ctx).onSubmit({ queries: "alpha" });
  expect(calls[1]?.bookId).toBeUndefined();
});

test("failed host search rejects instead of returning a false no-matches view", async () => {
  const { ctx } = context();
  const failure = Error("injected storage failure");
  ctx.domains.library!.queries.books.searchText = async () => { throw failure; };
  await expect(textSearchForm(ctx).onSubmit({ queries: "alpha" })).rejects.toBe(failure);
});
