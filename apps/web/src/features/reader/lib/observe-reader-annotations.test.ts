import { expect, test } from "bun:test";
import type { Highlight, Note } from "../../annotations/lib/annotation-types";
import type { FoliateAnnotation } from "./foliate-engine";
import { createReaderAnnotationMarks } from "./observe-reader-annotations";

const base = { bookId: "book", chapterHref: "chapter", text: "text", createdAt: "now", updatedAt: "now" };
const highlight = (id: string, cfiRange: string, bookId = "book"): Highlight => ({
  ...base,
  bookId,
  type: "highlight",
  color: "yellow",
  id,
  cfiRange,
});

function fixture() {
  const added: string[] = [],
    deleted: string[] = [],
    changes: string[][] = [];
  const highlights = { current: [] as Highlight[] },
    notes = { current: [] as Note[] };
  const marks = createReaderAnnotationMarks(
    "book",
    {
      addAnnotation: async (item: FoliateAnnotation) => {
        added.push(item.value);
        return undefined;
      },
      deleteAnnotation: async (item: FoliateAnnotation) => {
        deleted.push(item.value);
        return undefined;
      },
    },
    highlights,
    notes,
    (items) => changes.push(items.map((item) => item.id)),
  );
  return { marks, added, deleted, changes, highlights };
}

test("an adopted stored mark is drawn at once and the next snapshot does not repaint it", async () => {
  const f = fixture();
  await f.marks.show([highlight("old", "a")]);
  f.added.length = 0;

  await f.marks.adopt(highlight("new", "b"));
  expect(f.added).toEqual(["b"]);
  expect(f.highlights.current.map((item) => item.id)).toEqual(["new", "old"]);
  expect(f.changes.at(-1)).toEqual(["new", "old"]);

  await f.marks.show([highlight("new", "b"), highlight("old", "a")]);
  expect(f.added).toEqual(["b"]);
  expect(f.deleted).toEqual([]);
});

test("the observer stays the authority over an adopted mark", async () => {
  const f = fixture();
  await f.marks.adopt(highlight("new", "b"));
  await f.marks.show([]);
  expect(f.deleted).toEqual(["b"]);
  expect(f.highlights.current).toEqual([]);
});

test("adopting replaces a row by id and ignores other books and retired sessions", async () => {
  const f = fixture();
  await f.marks.adopt(highlight("h", "a"));
  await f.marks.adopt({ ...highlight("h", "a"), color: "blue" });
  expect(f.highlights.current.map((item) => item.color)).toEqual(["blue"]);
  expect(f.added).toEqual(["a", "a"]);

  await f.marks.adopt(highlight("elsewhere", "z", "other-book"));
  f.marks.lifetime.abort();
  await f.marks.adopt(highlight("late", "y"));
  expect(f.highlights.current.map((item) => item.id)).toEqual(["h"]);
  expect(f.added).toEqual(["a", "a"]);
});
