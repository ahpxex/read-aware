import { describe, expect, test } from "bun:test";
import type { ChapterRef } from "../ports";
import { findChapterByHref, hrefMatches } from "./chapter-lookup";

describe("hrefMatches", () => {
  test("ignores fragments and URI encoding", () => {
    expect(hrefMatches("text/ch2.xhtml#s3", "text/ch2.xhtml")).toBe(true);
    expect(hrefMatches("text/ch%202.xhtml", "text/ch 2.xhtml")).toBe(true);
  });

  test("suffix matches only on path boundaries", () => {
    expect(hrefMatches("OEBPS/text/ch1.html", "text/ch1.html")).toBe(true);
    expect(hrefMatches("../text/ch1.html", "text/ch1.html")).toBe(true);
    expect(hrefMatches("part0010.html", "0.html")).toBe(false);
  });

  test("empty hrefs never match", () => {
    expect(hrefMatches("", "ch1.html")).toBe(false);
  });
});

describe("findChapterByHref", () => {
  const toc: ChapterRef[] = [
    { index: 0, title: "Intro", chars: 100, hrefs: ["intro.xhtml"] },
    {
      index: 1,
      title: "Chapter 1",
      chars: 100,
      // 跨文件章节：TOC 条目 href + 两个 spine section id
      hrefs: ["text/ch1.xhtml#start", "text/ch1.xhtml", "text/ch1b.xhtml"],
    },
    { index: 2, title: "Chapter 2", chars: 100, hrefs: ["text/ch2.xhtml"] },
  ];

  test("resolves the reading position to its covering chapter", () => {
    expect(findChapterByHref(toc, "text/ch2.xhtml#p5")?.index).toBe(2);
    // 章节第二个文件里的位置也归到第 1 章
    expect(findChapterByHref(toc, "text/ch1b.xhtml")?.index).toBe(1);
  });

  test("returns undefined when nothing covers the href", () => {
    expect(findChapterByHref(toc, "notes.xhtml")).toBeUndefined();
    expect(findChapterByHref([{ index: 0, chars: 10 }], "ch1.html")).toBeUndefined();
  });
});
