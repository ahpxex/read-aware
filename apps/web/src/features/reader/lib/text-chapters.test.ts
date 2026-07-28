import { describe, expect, test } from "bun:test";
import {
  labelFromOpeningWords,
  linesToParagraphs,
  splitTextIntoChapters,
} from "./text-chapters";
import { decodeTextBook } from "./decode-text";

const titles = (text: string) =>
  splitTextIntoChapters(text).map((chapter) => chapter.title);

describe("marked headings", () => {
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

  test("accepts punctuation, no space, and full-width digits after the marker", () => {
    expect(titles(["第一章：开端", "a", "第2章.承接", "b", "第１０章　结局", "c"].join("\n"))).toEqual([
      "第一章：开端",
      "第2章.承接",
      "第10章 结局",
    ]);
  });

  test("recognizes volume markers and front/back matter with titles", () => {
    expect(titles(["楔子 雨夜", "a", "卷一 少年", "b", "第一章 启程", "c", "尾声", "d"].join("\n"))).toEqual([
      "楔子 雨夜",
      "卷一 少年",
      "第一章 启程",
      "尾声",
    ]);
  });

  test("recognizes English headings", () => {
    expect(titles(["Prologue", "a", "Chapter One", "b", "Chapter 2: The Road", "c"].join("\n"))).toEqual([
      "Prologue",
      "Chapter One",
      "Chapter 2: The Road",
    ]);
  });

  test("a chapter marker inside a sentence is not a heading", () => {
    const prose = "他翻到第三章的时候才明白，这一切早有伏笔，而作者把线索藏在了别处。";
    expect(splitTextIntoChapters([prose, prose, prose, prose].join("\n"))).toHaveLength(1);
  });

  test("fewer than three headings stays unstructured rather than half-split", () => {
    expect(splitTextIntoChapters(["Chapter 1", "a", "Chapter 2", "b"].join("\n"))).toHaveLength(1);
  });
});

describe("numbered headings", () => {
  test("bare numbers, with or without a short title", () => {
    expect(titles(["01", "a", "02 初遇", "b", "03、别离", "c"].join("\n"))).toEqual([
      "01",
      "02 初遇",
      "03、别离",
    ]);
  });

  test("a bare Chinese numeral on its own line is a chapter", () => {
    const chapter = (n: string, body: string) => [n, body];
    const text = [
      "书名",
      "",
      ...chapter("一", "第一章的正文，" + "字".repeat(60)),
      ...chapter("二", "第二章的正文，" + "字".repeat(60)),
      ...chapter("三", "第三章的正文，" + "字".repeat(60)),
      ...chapter("十", "第十章的正文，" + "字".repeat(60)),
    ].join("\n");
    expect(titles(text)).toEqual([undefined, "一", "二", "三", "十"]);
  });

  test("the book's own contents listing is not mistaken for chapters", () => {
    // Mirrors how a real .txt opens: a packed list of headings, then the book.
    const body = (label: string) => [label, "正文，" + "字".repeat(80), ""];
    const text = [
      "序",
      "",
      "二",
      "",
      "三",
      "",
      "附录 后记",
      "",
      ...body("序"),
      ...body("一"),
      ...body("二"),
      ...body("三"),
      ...body("附录 后记"),
    ].join("\n");
    // The listing lines are still the book's own text, so they survive as the
    // untitled leading section rather than being deleted.
    expect(titles(text)).toEqual([undefined, "序", "一", "二", "三", "附录 后记"]);
  });

  test("Chinese numerals need their separator", () => {
    expect(titles(["一、初遇", "a", "二、别离", "b", "三、重逢", "c"].join("\n"))).toEqual([
      "一、初遇",
      "二、别离",
      "三、重逢",
    ]);
    // Prose opening with 一 is not a heading, so this file has no structure.
    expect(
      splitTextIntoChapters(["一个人走进来", "a", "两个人离开", "b", "三个人回来", "c"].join("\n")),
    ).toHaveLength(1);
  });

  test("a numbered list inside the prose is not chapter numbering", () => {
    // Numbers that restart and repeat do not read like chapters.
    const text = [
      "买菜清单如下。",
      "1. 西红柿",
      "2. 鸡蛋",
      "3. 面条",
      "回来之后又想起：",
      "1. 酱油",
      "2. 醋",
    ].join("\n");
    expect(splitTextIntoChapters(text)).toHaveLength(1);
  });

  test("numbering that starts far from one is rejected", () => {
    expect(splitTextIntoChapters(["87", "a", "94", "b", "231", "c"].join("\n"))).toHaveLength(1);
  });

  test("marked headings survive even when the numbering is rejected", () => {
    const text = ["第一章 开端", "清单：", "7. 七", "9. 九", "第二章 承接", "b", "第三章 结局", "c"].join("\n");
    expect(titles(text)).toEqual(["第一章 开端", "第二章 承接", "第三章 结局"]);
  });
});

describe("labels", () => {
  test("an untitled run is labelled by its opening words", () => {
    expect(labelFromOpeningWords(["", "  雨下了整夜，屋檐滴水的声音一直没停，天亮时才安静下来。"])).toBe(
      "雨下了整夜，屋檐滴水的声音一直没停，天亮时才安静…",
    );
    expect(labelFromOpeningWords(["短句。"])).toBe("短句。");
    expect(labelFromOpeningWords(["", "  "])).toBeUndefined();
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
    expect(decodeTextBook(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))).toBe("中文");
  });

  test("keeps plain ASCII on the UTF-8 path", () => {
    expect(decodeTextBook(new TextEncoder().encode("hello world"))).toBe("hello world");
  });
});
