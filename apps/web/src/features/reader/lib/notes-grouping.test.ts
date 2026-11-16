import { expect, test } from "bun:test";
import type { BookTocEntry, Bookmark } from "@read-aware/core";
import type { Annotation } from "../../annotations";
import { chapterAnchorsFromToc, groupMarksByChapter, type Mark } from "./notes-grouping";
import type { TocEntry } from "./reader-types";

const toc: TocEntry[] = [
  { id: "1", href: "one.xhtml", label: "One", depth: 0, spineIndex: 0 },
  { id: "2", href: "two.xhtml#start", label: "Two", depth: 0, spineIndex: 1 },
];
const bookmark = (id: string, chapterHref: string | undefined, createdAt: string): Mark => ({
  kind: "bookmark",
  bookmark: {
    id,
    bookId: "b",
    name: id,
    kind: "location",
    target: { contentVersion: "v", fraction: 0 },
    ...(chapterHref ? { chapterHref } : {}),
    createdAt,
    updatedAt: createdAt,
  } satisfies Bookmark,
});
const highlight = (id: string, chapterHref: string | null, createdAt: string): Mark => ({
  kind: "annotation",
  annotation: {
    id,
    bookId: "b",
    type: "highlight",
    color: "yellow",
    cfiRange: null,
    chapterHref,
    text: id,
    createdAt,
    updatedAt: createdAt,
  } satisfies Annotation,
});
const ids = (marks: Mark[]) => marks.map((m) => (m.kind === "bookmark" ? m.bookmark.id : m.annotation.id));

test("bookmarks and annotations share chapter groups, newest first", () => {
  const groups = groupMarksByChapter(
    [
      highlight("h-old", "two.xhtml", "2026-01-01T00:00:00Z"),
      bookmark("b-new", "two.xhtml#mid", "2026-03-01T00:00:00Z"),
      highlight("h-mid", "two.xhtml", "2026-02-01T00:00:00Z"),
      bookmark("b-one", "one.xhtml", "2026-01-05T00:00:00Z"),
      bookmark("b-nowhere", undefined, "2026-04-01T00:00:00Z"),
      highlight("h-orphan", "gone.xhtml", "2026-01-02T00:00:00Z"),
    ],
    toc,
  );
  expect(groups.map((group) => [group.label, ids(group.items)])).toEqual([
    ["One", ["b-one"]],
    ["Two", ["b-new", "h-mid", "h-old"]],
    [null, ["b-nowhere", "h-orphan"]],
  ]);
});

test("the library contents tree becomes chapter anchors in reading order", () => {
  const entry = (label: string, href: string | null, children: BookTocEntry[] = []): BookTocEntry => ({
    id: label,
    label,
    ordinal: 0,
    sectionIndex: null,
    location: href ? { bookId: "b", contentVersion: "v", href } : null,
    children,
  });
  const anchors = chapterAnchorsFromToc([
    entry("Part One", "part1.xhtml", [entry("Chapter 1", "ch1.xhtml"), entry("Unresolved", null)]),
    entry("Part Two", "part2.xhtml", [entry("Chapter 2", "ch2.xhtml#s")]),
  ]);
  expect(anchors).toEqual([
    { href: "part1.xhtml", label: "Part One" },
    { href: "ch1.xhtml", label: "Chapter 1" },
    { href: "part2.xhtml", label: "Part Two" },
    { href: "ch2.xhtml#s", label: "Chapter 2" },
  ]);

  // A mark in a nested chapter groups under that chapter, not its part.
  const note = (id: string, chapterHref: string): Mark => ({
    kind: "annotation",
    annotation: {
      id,
      bookId: "b",
      type: "highlight",
      color: "yellow",
      cfiRange: "epubcfi(/6/2)",
      chapterHref,
      text: id,
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
    },
  });
  const groups = groupMarksByChapter([note("a", "ch2.xhtml#s"), note("b", "part1.xhtml")], anchors);
  expect(groups.map((group) => [group.label, group.items.length])).toEqual([
    ["Part One", 1],
    ["Chapter 2", 1],
  ]);
});
