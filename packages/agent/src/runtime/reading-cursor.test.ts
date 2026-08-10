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
    expect(prompt.indexOf("> A selected sentence.")).toBeLessThan(
      prompt.indexOf("这段话是什么意思？"),
    );
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
