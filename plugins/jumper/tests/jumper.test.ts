import { expect, test } from "bun:test";
import type { BookTocEntry, PluginFormView, PluginListView, PluginView, PluginViewResult, PluginViewUpdate, ReadingLocation } from "@read-aware/plugin-types";
import { chapterNumber, findChapters } from "../src/chapters";
import { jumperView } from "../src/views";
import type { JumperContext } from "../src/types";
import { textSearchView } from "../src/text-search";

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
  const updates: PluginViewUpdate[] = [];
  const ctx = { locale: "zh-Hans", services: { ui: { publishView: async (_channel: unknown, update: PluginViewUpdate) => {
    updates.push(update); return { status: "applied" };
  } } }, domains: {
    library: { queries: { books: { getNavigationToc: async () => ({ bookId: "book", contentVersion: "v1", entries }),
      searchLocations: async () => ({ bookId: "book", contentVersion: "v1", hits: [], nextCursor: "next", textStatus: "partial", scannedSections: 32, totalSections: 40 }),
    } } },
    reading: { queries: { session: async () => ({ bookId: "book", sessionId: "session", history: { canGoBack: true, canGoForward: true } }) },
      commands: { goTo: async (target: ReadingLocation) => { jumps.push(target); } },
    },
  } } as unknown as JumperContext;
  return { ctx, jumps, updates };
}
async function mount(view: PluginView, id = "channel") {
  const subscription = await view.live!.subscribe({ id });
  await Bun.sleep(0);
  return subscription;
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
  const { ctx, updates } = fixture();
  const task = (await (await form(ctx)).onSubmit({ mode: "text", query: "needle" }))!.view!;
  expect(task).toMatchObject({ kind: "blocks", blocks: [{ kind: "progress", value: null }] });
  await mount(task);
  const result = list({ view: updates[updates.length - 1]!.view });
  expect(result.emptyText).toBe("本批次没有匹配结果。");
  let input: unknown;
  ctx.domains.library.queries.books.searchLocations = async next => {
    input = next;
    return { bookId: "book", contentVersion: "v1", hits: [], nextCursor: null, textStatus: "available", scannedSections: 40, totalSections: 40 };
  };
  await mount((await result.actions![0].run())!.view!, "next");
  expect(list({ view: updates[updates.length - 1]!.view }).emptyText).toBe("没有匹配结果。");
  expect(input).toMatchObject({ bookId: "book", query: "needle", cursor: "next", contentVersion: "v1" });
});

test("cancel stops only the current query and ignores a late successful reply", async () => {
  const { ctx, updates } = fixture();
  const calls: Array<{ signal: AbortSignal; resolve: (page: Awaited<ReturnType<typeof ctx.domains.library.queries.books.searchLocations>>) => void }> = [];
  ctx.domains.library.queries.books.searchLocations = (_input, options) => new Promise(resolve => calls.push({ signal: options!.signal!, resolve }));
  const first = textSearchView(ctx, { bookId: "book", query: "first" });
  const sibling = textSearchView(ctx, { bookId: "book", query: "sibling" });
  expect(calls).toHaveLength(0);
  await mount(first);
  const siblingSubscription = await mount(sibling, "sibling");
  expect(calls).toHaveLength(2);
  if (first.kind !== "blocks" || first.blocks[0].kind !== "progress") throw new Error("Expected progress");
  await first.blocks[0].cancel!.run();
  expect(calls[0].signal.aborted).toBe(true);
  expect(calls[1].signal.aborted).toBe(false);
  expect(updates[updates.length - 1]!.view).toMatchObject({ kind: "list", emptyText: "搜索已取消。" });
  const count = updates.length;
  calls[0].resolve({ bookId: "book", contentVersion: "v1", hits: [], nextCursor: null, textStatus: "available", scannedSections: 1, totalSections: 1 });
  await Bun.sleep(0);
  expect(updates).toHaveLength(count);
  siblingSubscription.dispose();
  calls[1].resolve({ bookId: "book", contentVersion: "v1", hits: [], nextCursor: null, textStatus: "available", scannedSections: 1, totalSections: 1 });
  await Bun.sleep(0);
});

test("hiding or closing a pending search cancels it; restoring the frame never restarts it", async () => {
  const { ctx, updates } = fixture();
  let signal: AbortSignal | undefined, calls = 0;
  ctx.domains.library.queries.books.searchLocations = (_input, options) => {
    calls++; signal = options!.signal;
    return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
  };
  const view = textSearchView(ctx, { bookId: "book", query: "needle" });
  const old = await mount(view);
  const replacement = await mount(view, "replacement");
  old.dispose();
  expect(signal!.aborted).toBe(false);
  replacement.dispose();
  expect(signal!.aborted).toBe(true);
  await mount(view, "restored");
  expect(calls).toBe(1);
  expect(updates[updates.length - 1]!.view).toMatchObject({ emptyText: "搜索已取消。" });
  const unmounted = textSearchView(ctx, { bookId: "book", query: "never" });
  await unmounted.onClose!({ reason: "closed" });
  await mount(unmounted, "closed");
  expect(calls).toBe(1);
});

test("failed searches show a host error code and retry uses a fresh signal and the same input", async () => {
  const { ctx, updates } = fixture();
  const inputs: unknown[] = [], signals: AbortSignal[] = [];
  ctx.domains.library.queries.books.searchLocations = async (input, options) => {
    inputs.push(input); signals.push(options!.signal!);
    throw Object.assign(new Error("private details"), { code: "db/locked" });
  };
  const input = { bookId: "book", query: "needle", cursor: "cursor", contentVersion: "v1", matchCase: true };
  await mount(textSearchView(ctx, input));
  const error = updates[updates.length - 1]!.view;
  expect(error).toMatchObject({ kind: "blocks", blocks: [{ kind: "error", code: "db/locked" }, { kind: "actions" }] });
  expect(JSON.stringify(error)).not.toContain("private details");
  if (error.kind !== "blocks" || error.blocks[1].kind !== "actions") throw new Error("Expected retry");
  const retry = await error.blocks[1].actions[0].run();
  expect(retry!.navigation).toBe("replace");
  await mount(retry!.view!, "retry");
  expect(inputs).toEqual([input, input]);
  expect(signals[0]).not.toBe(signals[1]);
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

test("completed text matches retain their versioned location and do not search again when restored", async () => {
  const { ctx, updates, jumps } = fixture();
  let calls = 0;
  ctx.domains.library.queries.books.searchLocations = async () => {
    calls++;
    return { bookId: "book", contentVersion: "v1", hits: [{ id: "hit", sectionIndex: 0, location,
      range: { bookId: "book", contentVersion: "v1", cfi: "epubcfi(/6/2!/4/2/1:0)" },
      excerpt: { pre: "before ", match: "needle", post: " after" } }],
      nextCursor: null, textStatus: "available", scannedSections: 1, totalSections: 1 };
  };
  const view = textSearchView(ctx, { bookId: "book", query: "needle" });
  const subscription = await mount(view);
  subscription.dispose();
  await mount(view, "restored");
  expect(calls).toBe(1);
  const result = list({ view: updates[updates.length - 1]!.view });
  expect(result.items[0].title).toBe("before needle after");
  expect(await result.items[0].onSelect!()).toEqual({ close: true });
  expect(jumps).toEqual([location]);
});

test("stale locations do not offer a guaranteed-failing retry of the same cursor", async () => {
  const { ctx, updates } = fixture();
  ctx.domains.library.queries.books.searchLocations = async () => { throw { code: "reader/stale-location" }; };
  await mount(textSearchView(ctx, { bookId: "book", query: "needle", cursor: "old" }));
  expect(updates[updates.length - 1]!.view).toMatchObject({ kind: "blocks", blocks: [{ kind: "error", code: "reader/stale-location" }] });
});
