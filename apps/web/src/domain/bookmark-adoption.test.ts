import { expect, test } from "bun:test";
import { jumperBookmarkAdoption } from "./bookmark-adoption";

const row = (data: unknown, id = "d1") => ({ id, json: JSON.stringify(data), updatedAt: "2026-05-01T10:00:00.000Z" });
const jumper = (target: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  version: 1,
  name: "  Where the duel starts ",
  bookTitle: "Book",
  kind: "location",
  target: { bookId: "b1", contentVersion: "v1", ...target },
  ...extra,
});

test("a Jumper bookmark becomes a library bookmark on its own book", () => {
  expect(jumperBookmarkAdoption(row(jumper({ cfi: "epubcfi(/6/4!/4/2:0)" })))).toEqual({
    documentId: "d1",
    createdAt: "2026-05-01T10:00:00.000Z",
    bookmark: {
      bookId: "b1",
      name: "Where the duel starts",
      kind: "location",
      target: { contentVersion: "v1", cfi: "epubcfi(/6/4!/4/2:0)" },
    },
  });
  const selection = jumperBookmarkAdoption(
    row(jumper({ cfi: "epubcfi(/6/4!/4/2,/1:0,/1:5)", textQuote: { exact: "duel" } }, { kind: "selection" })),
  );
  expect(selection?.bookmark.target).toEqual({
    contentVersion: "v1",
    cfi: "epubcfi(/6/4!/4/2,/1:0,/1:5)",
    textQuote: { exact: "duel" },
  });
  expect(jumperBookmarkAdoption(row(jumper({ fraction: 0.25 })))?.bookmark.target).toEqual({
    contentVersion: "v1",
    fraction: 0.25,
  });
});

test("documents the library cannot hold are left alone", () => {
  expect(jumperBookmarkAdoption({ id: "x", json: "{", updatedAt: "" })).toBeNull();
  expect(jumperBookmarkAdoption(row(jumper({ href: "a.xhtml" }, { version: 2 })))).toBeNull();
  expect(jumperBookmarkAdoption(row(jumper({ href: "a.xhtml" }, { name: " " })))).toBeNull();
  expect(jumperBookmarkAdoption(row(jumper({ href: "a.xhtml" }, { kind: "selection" })))).toBeNull();
  expect(jumperBookmarkAdoption(row(jumper({})))).toBeNull();
  expect(
    jumperBookmarkAdoption(row({ ...jumper({ href: "a" }), target: { contentVersion: "v1", href: "a" } })),
  ).toBeNull();
});
