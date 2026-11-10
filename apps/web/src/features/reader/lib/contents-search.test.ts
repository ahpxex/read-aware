import { expect, test } from "bun:test";
import type { Bookmark, BookLocationHit, BookTocEntry } from "@read-aware/core";
import type { Annotation } from "../../annotations/lib/annotation-types";
import {
  sectionChapterLabels,
  chapterNumber,
  chapterTitleHits,
  groupHitsByChapter,
  isPageLabelQuery,
  matchAnnotations,
  matchBookmarks,
  matchChapters,
  printedChapterNumber,
  wantsMatchCase,
} from "./contents-search";
import type { TocEntry } from "./reader-types";

const toc = (labels: string[]): TocEntry[] =>
  labels.map((label, index) => ({ id: String(index), href: `${index}.xhtml`, label, depth: 0, spineIndex: index }));

test("chapter numbers read Arabic and Chinese numerals", () => {
  expect(chapterNumber("12")).toBe(12);
  expect(chapterNumber("１２")).toBe(12);
  expect(chapterNumber("十二")).toBe(12);
  expect(chapterNumber("一百零五")).toBe(105);
  expect(chapterNumber("一二")).toBe(12);
  expect(chapterNumber("两万")).toBe(20000);
  expect(chapterNumber("0")).toBeNull();
  expect(chapterNumber("twelve")).toBeNull();
  expect(printedChapterNumber("第十二章 地球叛军")).toBe(12);
  expect(printedChapterNumber("第 3 回")).toBe(3);
  expect(printedChapterNumber("Chapter 7: Dawn")).toBe(7);
  expect(printedChapterNumber("12. The End")).toBe(12);
  expect(printedChapterNumber("Prologue")).toBeNull();
});

test("a number finds the printed chapter, else the Nth entry; words find titles", () => {
  const entries = toc(["序章", "第一章 科学边界", "第二章 台球", "第十二章 三体、墨子、烈焰"]);
  expect(matchChapters(entries, "12")).toEqual([3]);
  expect(matchChapters(entries, "十二")).toEqual([3]);
  expect(matchChapters(entries, "2")).toEqual([2]);
  const unnumbered = toc(["Prologue", "The Duel", "Aftermath"]);
  expect(matchChapters(unnumbered, "2")).toEqual([1]);
  expect(matchChapters(unnumbered, "9")).toEqual([]);
  expect(matchChapters(entries, "台球")).toEqual([2]);
  expect(matchChapters(unnumbered, "DUEL")).toEqual([1]);
});

test("bookmarks and marks match by name, passage and note text", () => {
  const at = "2026-01-01T00:00:00Z";
  const bookmark = (name: string): Bookmark => ({
    id: name,
    bookId: "b",
    name,
    kind: "location",
    target: { contentVersion: "v", fraction: 0 },
    createdAt: at,
    updatedAt: at,
  });
  expect(matchBookmarks([bookmark("Where Ye Wenjie speaks"), bookmark("End")], "wenjie").map((b) => b.id)).toEqual([
    "Where Ye Wenjie speaks",
  ]);
  const base = { bookId: "b", cfiRange: null, chapterHref: null, createdAt: at, updatedAt: at };
  const marks: Annotation[] = [
    { ...base, id: "h", type: "highlight", text: "The universe flickered", color: "yellow" },
    { ...base, id: "n", type: "note", text: "", content: "Ask about the countdown" },
    { ...base, id: "a", type: "ask", text: "Why the countdown?" },
  ];
  expect(matchAnnotations(marks, "flicker").map((m) => m.id)).toEqual(["h"]);
  expect(matchAnnotations(marks, "countdown").map((m) => m.id)).toEqual(["n"]);
});

test("page labels are short tokens; capitals ask for exact case", () => {
  expect(isPageLabelQuery("42")).toBe(true);
  expect(isPageLabelQuery("xiv")).toBe(true);
  expect(isPageLabelQuery("two words")).toBe(false);
  expect(wantsMatchCase("Ye")).toBe(true);
  expect(wantsMatchCase("ye")).toBe(false);
});

test("a section's chapter is the first entry starting in it, else the last one before it", () => {
  const entry = (label: string, sectionIndex: number | null, children: BookTocEntry[] = []): BookTocEntry => ({
    id: label,
    label,
    ordinal: 0,
    sectionIndex,
    location: null,
    children,
  });
  const chapterOf = sectionChapterLabels([
    entry("Part One", null, [entry("Chapter 1", 2), entry("Chapter 1, part 2", 2), entry("Chapter 2", 4)]),
    entry("Afterword", 7),
  ]);
  expect(chapterOf(2)).toBe("Chapter 1");
  expect(chapterOf(3)).toBe("Chapter 1, part 2");
  expect(chapterOf(5)).toBe("Chapter 2");
  expect(chapterOf(7)).toBe("Afterword");
  expect(chapterOf(0)).toBeUndefined();
});

test("a hit on a line that is a listed chapter's whole title repeats that chapter", () => {
  const hit = (match: string, blockText?: string): BookLocationHit => ({
    id: match,
    sectionIndex: 0,
    excerpt: { pre: "", match, post: "" },
    ...(blockText === undefined ? {} : { blockText }),
    location: { bookId: "b", contentVersion: "v" },
    range: { bookId: "b", contentVersion: "v", cfi: "epubcfi(/6/2)" },
  });
  const isTitle = chapterTitleHits(["第二章 台球", "Chapter 9: Red Coast"]);
  // The heading, or the chapter's line on a contents page: spacing and case differ freely.
  expect(isTitle(hit("台", "第二章 台 球"))).toBe(true);
  expect(isTitle(hit("台", "第二章　台球"))).toBe(true);
  expect(isTitle(hit("red", "CHAPTER 9: RED COAST"))).toBe(true);
  // The title's words inside a longer line, or another short line, are the book's text.
  expect(isTitle(hit("台", "他想起了第二章 台球"))).toBe(false);
  expect(isTitle(hit("red", "Red Coast"))).toBe(false);
  // Running text carries no block text.
  expect(isTitle(hit("台"))).toBe(false);
  // No chapter listed: nothing is a title, an empty line included.
  expect(chapterTitleHits([])(hit("台", "第二章 台球"))).toBe(false);
  expect(chapterTitleHits([""])(hit("x", ""))).toBe(false);
});

test("text hits group into runs under the chapter each is in", () => {
  const hit = (id: string, sectionIndex: number): BookLocationHit => ({
    id,
    sectionIndex,
    excerpt: { pre: "", match: id, post: "" },
    location: { bookId: "b", contentVersion: "v" },
    range: { bookId: "b", contentVersion: "v", cfi: "epubcfi(/6/2)" },
  });
  const hits = [hit("a", 0), hit("b", 1), hit("c", 2), hit("d", 2), hit("e", 3)];
  // Sections 1 and 2 are one chapter split over two files; section 0 precedes the contents.
  const chapterOf = (sectionIndex: number) => [undefined, "One", "One", "Two"][sectionIndex];
  const ids = (groups: ReturnType<typeof groupHitsByChapter>) =>
    groups.map((group) => [group.chapter, group.hits.map((item) => item.id)]);
  expect(ids(groupHitsByChapter(hits, chapterOf))).toEqual([
    [undefined, ["a"]],
    ["One", ["b", "c", "d"]],
    ["Two", ["e"]],
  ]);
  // Before the contents are read, every hit is in one unnamed run.
  expect(ids(groupHitsByChapter(hits, undefined))).toEqual([[undefined, ["a", "b", "c", "d", "e"]]]);
  expect(groupHitsByChapter([], chapterOf)).toEqual([]);
});
