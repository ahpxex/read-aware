import { expect, test } from "bun:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { createInMemoryDeps } from "../testing/fixtures";
import { chapterRangeOf } from "../testing/plain-text-layout";
import { buildBookTextTools } from "./book-text-tools";
import { createAgentTurnState } from "./turn-state";

const CHAPTERS = [
  { title: "序", text: "序言一段。\n序言二段。" },
  {
    title: "第二章",
    text: [
      "第二章",
      "说几句丁庄吧。",
      "丁庄有三条街。东西一条。南北两条。",
      "爷从新街走出来。他回了学校。",
      "终也舀不干。竟是越来越旺。",
      "庄人都散了。",
      "后来的事，谁也没料到。",
    ].join("\n"),
  },
  { title: "第三章", text: "第三章\n以后的事。" },
];

function fixture() {
  const { deps } = createInMemoryDeps({
    books: [{ id: "book", title: "Book", progressPercent: 40, status: "reading" }],
    chapters: { book: CHAPTERS, other: [{ title: "Other", text: "elsewhere" }] },
  });
  const state = createAgentTurnState();
  const tools = buildBookTextTools({ kind: "book", bookId: "book" }, deps, state);
  const run = async (name: string, params: Record<string, unknown>) => {
    const result: AgentToolResult<unknown> = await tools.find((tool) => tool.name === name)!.execute("call", params);
    if (result.content[0]?.type !== "text") throw new Error("Expected text");
    return JSON.parse(result.content[0].text);
  };
  return { deps, state, run, read: (params: Record<string, unknown>) => run("read_chapter", params) };
}

test("a chapter is read as addressed blocks, from any block or sentence", async () => {
  const { read, state } = fixture();
  const whole = await read({ chapterIndex: 1 });
  expect(whole).toMatchObject({
    chapterTitle: "第二章",
    unit: "paragraph",
    blocks: { first: 0, last: 6, total: 7 },
    next: null,
  });
  expect(whole.text.split("\n")).toEqual([
    "[0] 第二章",
    "[1] 说几句丁庄吧。",
    "[2] 丁庄有三条街。东西一条。南北两条。",
    "[3] 爷从新街走出来。他回了学校。",
    "[4] 终也舀不干。竟是越来越旺。",
    "[5] 庄人都散了。",
    "[6] 后来的事，谁也没料到。",
  ]);
  const from = await read({ chapterIndex: 1, paragraph: 2, sentence: 1 });
  expect(from.text.split("\n").slice(0, 2)).toEqual([
    "[2, from sentence 1] 东西一条。南北两条。",
    "[3] 爷从新街走出来。他回了学校。",
  ]);
  // What the model was shown is what an answer may be checked against: the text, without its addresses.
  expect(state.evidenceTexts[state.evidenceTexts.length - 1]).toStartWith("东西一条。南北两条。");
  await expect(read({ chapterIndex: 1, paragraph: 40 })).rejects.toThrow("has 7 paragraphs (0 to 6)");
  await expect(read({})).rejects.toThrow("chapterIndex must be a non-negative integer");
});

test("around reads the selection or the reader's page in place, with where it sits in the chapter", async () => {
  const { read, state } = fixture();
  state.readingRanges = {
    selection: chapterRangeOf(CHAPTERS, 1, "他回了学校。"),
    position: chapterRangeOf(CHAPTERS, 1, "爷从新街走出来。他回了学校。\n终也舀不干。"),
  };
  const selection = await read({ around: "selection", context: 1 });
  expect(selection).toMatchObject({
    chapterIndex: 1,
    blocks: { first: 2, last: 4, total: 7 },
    focus: { start: { paragraph: 3, sentence: 1 }, end: { paragraph: 3, sentence: 1 } },
    // In the reader's terms: counted from one, unlike the addresses.
    placeInChapter: "paragraph 4 of 7 counting from one, about 49% of the way through the chapter",
    next: null,
  });
  expect(selection.text.split("\n").map((line: string) => line.slice(0, 3))).toEqual(["[2]", "[3]", "[4]"]);
  const position = await read({ around: "position", context: 0 });
  expect(position.focus).toEqual({ start: { paragraph: 3, sentence: 0 }, end: { paragraph: 4, sentence: 0 } });
  expect(position.blocks).toEqual({ first: 3, last: 4, total: 7 });
  // The default takes two blocks on each side.
  expect((await read({ around: "selection" })).blocks).toEqual({ first: 1, last: 5, total: 7 });
  await expect(read({ around: "selection", chapterIndex: 2 })).rejects.toThrow("omit chapterIndex");
  await expect(read({ around: "selection", bookId: "other" })).rejects.toThrow("the book this conversation is about");
  state.readingRanges = {};
  await expect(read({ around: "selection" })).rejects.toThrow("No selected passage was located");
  await expect(read({ around: "position" })).rejects.toThrow("No reading position was located");
});

test("a narrative reader's own chapter is returned up to their position and never past it", async () => {
  const { read, state } = fixture();
  const page = chapterRangeOf(CHAPTERS, 1, "爷从新街走出来。他回了学校。\n终也舀不干。");
  const through = CHAPTERS[1]!.text.indexOf("竟是越来越旺");
  state.readingRanges = { position: page };
  state.spoilerFence = { throughChapterIndex: 0, readerChapterIndex: 1, readerChapterThrough: through };
  const chapter = await read({ chapterIndex: 1 });
  expect(chapter.text).toEndWith("[4] 终也舀不干。");
  expect(chapter.text).not.toContain("越来越旺");
  expect(chapter).toMatchObject({ next: null, readerPosition: { paragraph: 4, sentence: 0 } });
  expect(JSON.stringify(state.evidenceTexts)).not.toContain("越来越旺");
  // Context around the page cannot reach past it either, and the unread part cannot be addressed.
  const around = await read({ around: "position", context: 5 });
  expect(around.text).toEndWith("[4] 终也舀不干。");
  expect(around.blocks).toEqual({ first: 0, last: 4, total: 7 });
  await expect(read({ chapterIndex: 1, paragraph: 5 })).rejects.toThrow("beyond the reader's position");
  await expect(read({ chapterIndex: 1, paragraph: 4, sentence: 1 })).rejects.toThrow("beyond the reader's position");
  await expect(read({ chapterIndex: 2 })).rejects.toThrow("beyond the reader's position or viewport boundary");
  expect((await read({ chapterIndex: 0 })).text).toContain("序言二段。");
  // An explicit, host-verified spoiler grant reads on.
  state.spoilerPermissionGranted = true;
  expect((await read({ chapterIndex: 1, paragraph: 5, confirmSpoiler: true })).text).toContain("[6] 后来的事");
  // Without a position inside the chapter, the chapter stays closed as a whole.
  state.spoilerPermissionGranted = false;
  state.spoilerFence = { throughChapterIndex: 0, readerChapterIndex: 1 };
  await expect(read({ chapterIndex: 1 })).rejects.toThrow("beyond the reader's position or viewport boundary");
});

test("a long chapter is read in whole sentences with the address to continue from", async () => {
  const sentence = "这是第几句话并不要紧。";
  const { deps } = createInMemoryDeps({
    chapters: { long: [{ title: "长章", text: `开头一段。\n${sentence.repeat(2000)}\n结尾一段。` }] },
  });
  const tools = buildBookTextTools({ kind: "book", bookId: "long" }, deps, createAgentTurnState());
  const read = async (params: Record<string, unknown>) =>
    JSON.parse(
      (
        (await tools.find((tool) => tool.name === "read_chapter")!.execute("call", params)).content[0] as {
          text: string;
        }
      ).text,
    );
  let page = await read({ chapterIndex: 0 });
  expect(page.coverage.end - page.coverage.start).toBeLessThanOrEqual(12000);
  expect(page.text).toEndWith(sentence);
  let pages = 1;
  while (page.next) {
    const previous = page.coverage.end;
    page = await read({ chapterIndex: 0, ...page.next });
    expect(page.coverage.start).toBe(previous);
    pages++;
  }
  expect(pages).toBe(2);
  expect(page.text).toEndWith("[2] 结尾一段。");
});

test("a chapter's own headings come back as its outline; search hits carry their block", async () => {
  const { deps, run } = fixture();
  deps.bookText.getChapterLayout = async (_book, index) =>
    index === 1
      ? {
          unit: "paragraph",
          paragraphs: [0, 4, 12],
          sentences: [0, 4, 12],
          headings: [
            { paragraph: 0, level: 1 },
            { paragraph: 1, level: 2 },
          ],
        }
      : undefined;
  const chapter = await run("read_chapter", { chapterIndex: 1 });
  expect(chapter.outline).toEqual([
    { paragraph: 0, level: 1, title: "第二章" },
    { paragraph: 1, level: 2, title: "说几句丁庄吧。" },
  ]);
  expect(chapter.text.split("\n").slice(0, 2)).toEqual(["[0] # 第二章", "[1] ## 说几句丁庄吧。"]);
  const hits = await run("search_book_text", { queries: ["越来越旺"] });
  expect(hits.hits[0]).toMatchObject({ chapterIndex: 1, paragraph: 2 });
  expect(hits.hits[0].part).toBeUndefined();
  // A chapter with no layout of its own is one block of sentences.
  expect((await run("read_chapter", { chapterIndex: 2 })).blocks).toEqual({ first: 0, last: 0, total: 1 });
  const toc = await run("get_toc", {});
  expect(toc[1]).toMatchObject({ chapterIndex: 1, title: "第二章", blocks: 7 });
});
