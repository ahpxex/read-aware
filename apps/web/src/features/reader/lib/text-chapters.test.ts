import { describe, expect, test } from "bun:test";
import { linesToParagraphs, splitTextIntoChapters } from "./text-chapters";
import { decodeTextBook } from "./decode-text";

describe("plain-text chapter segmentation", () => {
  test("splits on Chinese chapter headings and keeps the preface", () => {
    const chapters = splitTextIntoChapters(
      ["卷首语", "", "第一章 开端", "正文一", "第二章 承接", "正文二", "第三章 结局", "正文三"].join("\n"),
    );
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      undefined,
      "第一章 开端",
      "第二章 承接",
      "第三章 结局",
    ]);
    expect(linesToParagraphs(chapters[1]!.lines)).toEqual(["正文一"]);
  });

  test("a chapter marker inside a sentence is not a heading", () => {
    const prose = "他翻到第三章的时候才明白，这一切早有伏笔，而作者把线索藏在了别处。";
    const chapters = splitTextIntoChapters([prose, prose, prose, prose].join("\n"));
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBeUndefined();
  });

  test("fewer than three headings stays unstructured rather than half-split", () => {
    const chapters = splitTextIntoChapters(["Chapter 1", "a", "Chapter 2", "b"].join("\n"));
    expect(chapters).toHaveLength(1);
  });

  test("headingless text still yields at least one section", () => {
    const chapters = splitTextIntoChapters("just one paragraph");
    expect(chapters).toHaveLength(1);
    expect(linesToParagraphs(chapters[0]!.lines)).toEqual(["just one paragraph"]);
  });
});

describe("plain-text decoding", () => {
  test("decodes UTF-8 and strips the BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("你好")]);
    expect(decodeTextBook(bytes)).toBe("你好");
  });

  test("falls back to GB18030 for legacy Chinese text", () => {
    // "中文" in GBK/GB18030.
    const bytes = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);
    expect(decodeTextBook(bytes)).toBe("中文");
  });

  test("keeps plain ASCII on the UTF-8 path", () => {
    expect(decodeTextBook(new TextEncoder().encode("hello world"))).toBe("hello world");
  });
});
