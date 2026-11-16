import { describe, expect, test } from "bun:test";
import { formatPromptTurn, formatReadingCursor } from "./reading-cursor";

describe("reading cursor prompt context", () => {
  test("describes the live viewport without exposing the opaque anchor", () => {
    const cursor = formatReadingCursor({
      anchor: "epubcfi(/6/8!/4/2)",
      chapter: "text/chapter-2.xhtml",
      chapterTitle: "The Turn",
      bookProgress: 0.421,
      chapterProgress: 0.637,
      location: { current: 84, total: 200 },
      visibleText: "The rain had stopped. Nobody had yet opened the letter.",
    });

    expect(cursor).toContain("newer than every earlier reading_cursor");
    expect(cursor).toContain('chapter_title: "The Turn"');
    expect(cursor).toContain("book_progress: 42%");
    expect(cursor).toContain("chapter_progress: approximately 64%");
    expect(cursor).toContain("book_location: 84 of 200");
    expect(cursor).toContain("Text after it may be unread");
    expect(cursor).toContain("later in this same chapter");
    expect(cursor).toContain("The rain had stopped");
    expect(cursor).not.toContain("epubcfi");
  });

  test("puts transient cursor context before the quoted passage and reader message", () => {
    const prompt = formatPromptTurn(
      "这段话是什么意思？",
      [{ text: "A selected sentence.", chapter: "chapter-2.xhtml" }],
      { chapterTitle: "Chapter 2", visibleText: "The currently visible page." },
    );

    expect(prompt.indexOf("<reading_cursor>")).toBeLessThan(prompt.indexOf("> A selected sentence."));
    expect(prompt.indexOf("> A selected sentence.")).toBeLessThan(prompt.indexOf("这段话是什么意思？"));
  });

  test("a located position is coordinates alone: no viewport text reaches the model", () => {
    const viewport = {
      chapterIndex: 4,
      chapterTitle: "The Turn",
      start: 120,
      end: 480,
      through: 512,
      unit: "paragraph" as const,
      blocks: 130,
      span: { start: { paragraph: 37, sentence: 0 }, end: { paragraph: 41, sentence: 2 } },
    };
    const selection = {
      ...viewport,
      span: { start: { paragraph: 39, sentence: 1 }, end: { paragraph: 39, sentence: 1 } },
    };
    const cursor = formatReadingCursor(
      { chapterTitle: "A subsection label", chapterProgress: 0.3, visibleText: "The rain had stopped." },
      { viewport, selections: [selection, undefined, { ...selection, chapterIndex: 5 }] },
    );
    expect(cursor.split("\n").slice(2, -1)).toEqual([
      'chapter_title: "The Turn"',
      "chapter_index: 4",
      "position: paragraph 37 sentence 0 through paragraph 41 sentence 2, of 130 paragraphs in this chapter",
      "selection: paragraph 39 sentence 1",
      "selection: chapter_index 5, paragraph 39 sentence 1",
      'coordinates: zero-based and the same ones read_chapter takes. This block holds no book text: read it with read_chapter (around="position" or around="selection").',
    ]);
    expect(cursor).not.toContain("The rain had stopped");
    expect(cursor).not.toContain("visible_text");
    expect(cursor).not.toContain("chapter_progress");
  });

  test("a selection located without a sampled cursor still reports where it is", () => {
    const selection = {
      chapterIndex: 2,
      start: 10,
      end: 30,
      unit: "page" as const,
      blocks: 12,
      span: { start: { paragraph: 3, sentence: 0 }, end: { paragraph: 4, sentence: 1 } },
    };
    const prompt = formatPromptTurn("这段话是什么意思？", [{ text: "A selected sentence." }], undefined, {
      selections: [selection],
    });
    expect(prompt).toContain("selection: chapter_index 2, page 3 sentence 0 through page 4 sentence 1");
    expect(prompt).toContain('read it with read_chapter (around="selection")');
    expect(prompt.indexOf("<reading_cursor>")).toBeLessThan(prompt.indexOf("> A selected sentence."));
  });

  test("keeps the authored turn first and appends only the language anchor without a cursor", () => {
    const prompt = formatPromptTurn("hello", undefined, undefined);
    expect(prompt.startsWith("hello")).toBe(true);
    expect(prompt).toContain("[host note: reply entirely in");
  });

  test("anchors the reply language to the dominant script of the user turn", () => {
    expect(formatPromptTurn("这本书讲了什么？")).toContain("reply entirely in Chinese");
    expect(formatPromptTurn("この本について教えて")).toContain("reply entirely in Japanese");
    expect(formatPromptTurn("Расскажи об этой книге")).toContain("reply entirely in Russian");
    expect(formatPromptTurn("What is this book about?")).toContain(
      "reply entirely in the exact language of the reader's message above",
    );
  });
});
