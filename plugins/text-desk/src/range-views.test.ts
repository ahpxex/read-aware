import { expect, test } from "bun:test";
import type { BookRangeQuery, PluginContext, PluginDetailView, PluginListView } from "@read-aware/plugin-types";
import { rangeDetail, rangeResults, rangeSearchForm } from "./range-views";

function fixture() {
  const range = { bookId: "book", contentVersion: "v1", cfi: "epubcfi(/6/2!/4/2,/1:0,/1:6)" };
  const reads: BookRangeQuery[] = [], jumps: unknown[] = [], searches: unknown[] = [];
  const ctx = { locale: "en", domains: {
    library: { queries: { books: {
      searchLocations: async (input: unknown) => { searches.push(input); return { bookId: "book", contentVersion: "v1", hits: [
        { id: "one", range, location: range, excerpt: { pre: "before ", match: "needle", post: " after" } },
      ], nextCursor: "next", textStatus: "available" }; },
      readRange: async (input: BookRangeQuery) => { reads.push(input); return { range: input.range, sectionIndex: 0,
        text: input.offset ? "dle" : "nee", offset: input.offset ?? 0, totalLength: 6, nextOffset: input.offset ? null : 3,
        context: { before: "before ", after: " after" } }; },
    } } },
    reading: { commands: { goTo: async (target: unknown) => { jumps.push(target); } } },
  } } as unknown as PluginContext;
  return { ctx, range, reads, jumps, searches };
}

test("passage form validates before queries; result selection reads without moving the reader", async () => {
  const { ctx, range, reads, jumps, searches } = fixture();
  const form = rangeSearchForm(ctx, "book");
  for (const query of [" ", "x".repeat(501)]) expect(await form.onSubmit({ query })).toHaveProperty("fieldErrors.query");
  expect(searches).toEqual([]);
  const result = await form.onSubmit({ query: " needle ", matchCase: true, wholeWords: false });
  expect(searches).toEqual([{ bookId: "book", query: "needle", matchCase: true, wholeWords: false, limit: 20 }]);
  const list = result!.view as PluginListView;
  const selected = await list.items[0].onSelect!();
  expect(reads).toEqual([{ range }]);
  expect(jumps).toEqual([]);
  const detail = selected!.view as PluginDetailView;
  expect(detail.content[1]).toMatchObject({ kind: "quote", text: "nee", caption: "1-3 / 6" });
  await detail.actions!.find(a => a.id === "next")!.run();
  expect(reads[1]).toEqual({ range, offset: 3 });
  await detail.actions!.find(a => a.id === "open-passage")!.run();
  expect(jumps).toEqual([range]);
  await list.actions![0].run();
  expect(searches[1]).toMatchObject({ contentVersion: "v1", cursor: "next" });
});

test("stale reads and failed searches reject, never display a fabricated empty or usable passage", async () => {
  const { ctx, range } = fixture();
  const failure = Object.assign(Error("internal detail"), { code: "reader/stale-location" });
  ctx.domains.library!.queries.books.readRange = async () => { throw failure; };
  await expect(rangeDetail(ctx, { range })).rejects.toBe(failure);
  ctx.domains.library!.queries.books.searchLocations = async () => { throw failure; };
  await expect(rangeResults(ctx, { bookId: "book", query: "needle" })).rejects.toBe(failure);
});
