import { expect, test } from "bun:test";
import type { BookTocEntry, PluginFormView, PluginListView, PluginViewResult, ReadingLocation } from "@read-aware/plugin-types";
import { chapterNumber, findChapters } from "../src/chapters";
import { jumperView } from "../src/views";
import type { JumperContext } from "../src/types";

const location: ReadingLocation = { bookId: "book", contentVersion: "v1", href: "chapter-12" };
const entries: BookTocEntry[] = [
  { id: "part", label: "Part One", ordinal: 1, sectionIndex: null, location: null, children: [
    { id: "chapter", label: "第十二章 起点", ordinal: 2, sectionIndex: 0, location, children: [] },
  ] },
  { id: "other", label: "Chapter 20", ordinal: 3, sectionIndex: 1, location: { ...location, href: "chapter-20" }, children: [] },
];

test("printed chapters, titles and TOC ordinals are not conflated", () => {
  expect(findChapters(entries, "12", "chapter").map(entry => entry.id)).toEqual(["chapter"]);
  expect(findChapters(entries, "十二", "chapter").map(entry => entry.id)).toEqual(["chapter"]);
  expect(findChapters(entries, "2", "chapter")).toEqual([]);
  expect(findChapters(entries, "2", "ordinal").map(entry => entry.id)).toEqual(["chapter"]);
  expect(findChapters(entries, "起点", "chapter").map(entry => entry.id)).toEqual(["chapter"]);
  expect(findChapters(entries, "20", "chapter").map(entry => entry.id)).toEqual(["other"]);
  expect(chapterNumber("１００")).toBe(100);
  expect(chapterNumber("一百零二")).toBe(102);
  expect(chapterNumber("两千零一")).toBe(2001);
  expect(chapterNumber("0")).toBeNull();
});

function fixture() {
  const jumps: ReadingLocation[] = [];
  const ctx = { locale: "zh-Hans", domains: {
    library: { queries: { books: { getNavigationToc: async () => ({ bookId: "book", contentVersion: "v1", entries }),
      searchLocations: async () => ({ bookId: "book", contentVersion: "v1", hits: [], nextCursor: "next", textStatus: "partial", scannedSections: 32, totalSections: 40 }),
    } } },
    reading: { queries: { session: async () => ({ bookId: "book", sessionId: "session", history: { canGoBack: true, canGoForward: true } }) },
      commands: { goTo: async (target: ReadingLocation) => { jumps.push(target); } },
    },
  } } as unknown as JumperContext;
  return { ctx, jumps };
}
async function form(ctx: JumperContext): Promise<PluginFormView> {
  const view = await jumperView(ctx);
  if (view.kind !== "blocks") throw new Error("Expected blocks");
  const form = view.blocks.find(block => block.kind === "form");
  if (!form || form.kind !== "form") throw new Error("Expected form");
  return form;
}
function list(result: PluginViewResult): PluginListView {
  if (!result || result.view?.kind !== "list") throw new Error("Expected list result");
  return result.view;
}

test("missing chapters produce field validation without moving the reader", async () => {
  const { ctx, jumps } = fixture();
  const view = await form(ctx);
  expect(await view.onSubmit({ mode: "chapter", query: "99" })).toEqual({ fieldErrors: { query: "该章节不存在。" } });
  expect(await view.onSubmit({ mode: "ordinal", query: "1" })).toEqual({ fieldErrors: { query: "此目录标题没有可跳转的位置。" } });
  expect(jumps).toHaveLength(0);
});

test("a unique chapter awaits actual navigation before closing", async () => {
  const { ctx, jumps } = fixture();
  expect(await (await form(ctx)).onSubmit({ mode: "chapter", query: "12" })).toEqual({ close: true });
  expect(jumps).toEqual([location]);
  ctx.domains.reading.commands.goTo = async () => { throw new Error("engine failure"); };
  await expect((await form(ctx)).onSubmit({ mode: "chapter", query: "12" })).rejects.toThrow("engine failure");
});

test("ambiguous chapters return choices instead of picking a destination", async () => {
  const { ctx, jumps } = fixture();
  ctx.domains.library.queries.books.getNavigationToc = async () => ({ bookId: "book", contentVersion: "v1",
    entries: [...entries, { ...entries[0].children[0], id: "duplicate", ordinal: 4 }] });
  const result = list(await (await form(ctx)).onSubmit({ mode: "chapter", query: "12" }));
  expect(result.items).toHaveLength(2);
  expect(jumps).toHaveLength(0);
  await result.items[0].onSelect!();
  expect(jumps).toEqual([location]);
});

test("empty search batches retain continuation and the pinned revision", async () => {
  const { ctx } = fixture();
  const result = list(await (await form(ctx)).onSubmit({ mode: "text", query: "needle" }));
  expect(result.emptyText).toBe("本批次没有匹配结果。");
  let input: unknown;
  ctx.domains.library.queries.books.searchLocations = async next => {
    input = next;
    return { bookId: "book", contentVersion: "v1", hits: [], nextCursor: null, textStatus: "available", scannedSections: 40, totalSections: 40 };
  };
  expect(list(await result.actions![0].run()).emptyText).toBe("没有匹配结果。");
  expect(input).toMatchObject({ bookId: "book", query: "needle", cursor: "next", contentVersion: "v1" });
});

test("back and forward retain the session guard without creating plugin-owned history", async () => {
  const { ctx } = fixture();
  const guards: unknown[] = [];
  ctx.domains.reading.commands.back = async guard => { guards.push(guard); return { status: "completed", sessionId: "session", location }; };
  const view = await jumperView(ctx);
  if (view.kind !== "blocks" || view.blocks[0].kind !== "actions") throw new Error("Expected history actions");
  await view.blocks[0].actions[0].run();
  expect(guards).toEqual([{ sessionId: "session" }]);
});
