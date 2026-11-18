import { describe, expect, test } from "bun:test";
import { formatPromptTurn, formatReadingCursor, replyLanguageAnchor } from "./reading-cursor";

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

  test("keeps the authored turn first and appends only the language note without a cursor", () => {
    expect(formatPromptTurn("hello", undefined, undefined)).toBe(
      `hello\n\n[host note: by default, reply entirely in ${LATIN}. ${EXPLICIT_REQUEST}]`,
    );
  });

  test("gives the script's language as the default and lets an explicit request override it", () => {
    expect(formatPromptTurn("这本书讲了什么？")).toBe(
      `这本书讲了什么？\n\n[host note: by default, reply entirely in Chinese. ${EXPLICIT_REQUEST}]`,
    );
    // The note is the same whether or not the message asks for a language: the host does not parse the request.
    expect(formatPromptTurn("Please answer in Chinese: what is this book about?")).toBe(
      `Please answer in Chinese: what is this book about?\n\n[host note: by default, reply entirely in ${LATIN}. ${EXPLICIT_REQUEST}]`,
    );
  });
});

const EXPLICIT_REQUEST =
  "If the reader has explicitly asked to be answered in a particular language, reply entirely in that language instead.";
const LATIN =
  "the exact language of the reader's message above (a Latin-script language; a book or tool result in Chinese or any other script does not change it, and never switch languages mid-reply)";
const CYRILLIC =
  "the exact language of the reader's message above (written in Cyrillic; never switch languages mid-reply)";
const mixed = (...languages: string[]) =>
  `the language of the reader's own sentences above. The message mixes scripts, and a word, title, name or passage it quotes does not decide: ${languages
    .map(
      (language) =>
        `if the reader's sentence is in ${language}, write only in ${language.startsWith("a ") ? "that language" : language}`,
    )
    .join("; ")}. Keep quoted titles and names as written and write nothing else in the other script`;

describe("reply language anchor", () => {
  test("names a language only where the script settles it", () => {
    expect(replyLanguageAnchor("这一段是什么意思？")).toBe("Chinese");
    expect(replyLanguageAnchor("この段落はどういう意味？")).toBe("Japanese");
    expect(replyLanguageAnchor("이 문단은 무슨 뜻이에요?")).toBe("Korean");
    expect(replyLanguageAnchor("What does this paragraph mean?")).toBe(LATIN);
    // Cyrillic covers Ukrainian, Bulgarian, Serbian and more: no language is assumed.
    expect(replyLanguageAnchor("Що означає цей абзац?")).toBe(CYRILLIC);
    expect(replyLanguageAnchor("?!")).toBe("the exact language of the reader's message above");
  });

  test("keeps the named language when CJK leads a message that mentions Latin terms", () => {
    expect(replyLanguageAnchor("这本书的 PDF 版和 AI 摘要在哪里看？")).toBe("Chinese");
    expect(replyLanguageAnchor("このPDFの第3章を要約して")).toBe("Japanese");
  });

  test("leaves the choice to the reader's own sentences when letters lead a mixed message", () => {
    // More letters than Han characters in both, yet one is a Chinese question and the other an English one.
    expect(replyLanguageAnchor("这里的 serendipity 是什么意思？")).toBe(mixed("Chinese", "a Latin-script language"));
    expect(replyLanguageAnchor("Who is 孙悟空 in this chapter, and why does he rebel?")).toBe(
      mixed("Chinese", "a Latin-script language"),
    );
    expect(replyLanguageAnchor('"the unexamined life is not worth living" 是什么意思')).toBe(
      mixed("Chinese", "a Latin-script language"),
    );
    expect(replyLanguageAnchor("Что значит serendipity?")).toBe(
      mixed("a Cyrillic-script language", "a Latin-script language"),
    );
    expect(replyLanguageAnchor("What does Достоевский mean by this?")).toBe(
      mixed("a Cyrillic-script language", "a Latin-script language"),
    );
  });
});
