import { expect, test } from "bun:test";
import type { Bookmark } from "@read-aware/core";
import type { Annotation } from "../../annotations/lib/annotation-types";
import {
  chapterNumber,
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
