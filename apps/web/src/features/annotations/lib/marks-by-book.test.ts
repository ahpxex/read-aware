import { expect, test } from "bun:test";
import type { Highlight, Note } from "./annotation-types";
import { groupMarksByBook } from "./marks-by-book";

const highlight = (id: string, bookId: string, createdAt: string): Highlight => ({
  id,
  bookId,
  type: "highlight",
  text: id,
  color: "yellow",
  cfiRange: null,
  chapterHref: null,
  createdAt,
  updatedAt: createdAt,
});
const note = (id: string, bookId: string, createdAt: string): Note => ({
  ...highlight(id, bookId, createdAt),
  type: "note",
  content: "",
});

test("the most recently marked book leads, each book's marks newest first", () => {
  const groups = groupMarksByBook(
    [
      highlight("a1", "a", "2026-10-01"),
      note("b1", "b", "2026-11-02"),
      highlight("a2", "a", "2026-11-01"),
      highlight("b2", "b", "2026-09-01"),
    ],
    [{ id: "a" }, { id: "b" }],
  );
  expect(groups.map((group) => [group.bookId, group.marks.map((mark) => mark.id)])).toEqual([
    ["b", ["b1", "b2"]],
    ["a", ["a2", "a1"]],
  ]);
});

test("a book that left the library keeps its marks, without a book; a book without marks is not listed", () => {
  const groups = groupMarksByBook([highlight("gone", "removed", "2026-11-01")], [{ id: "kept" }]);
  expect(groups).toEqual([{ bookId: "removed", book: null, marks: [expect.objectContaining({ id: "gone" })] }]);
});
