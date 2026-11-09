import { expect, test } from "bun:test";
import type { Bookmark } from "@read-aware/core";
import type { Annotation } from "../../annotations";
import { groupMarksByChapter, type Mark } from "./notes-grouping";
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
