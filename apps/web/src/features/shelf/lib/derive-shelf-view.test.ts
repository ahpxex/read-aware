import { expect, test } from "bun:test";
import type { TFunction } from "i18next";
import type { Collection, LibraryBook, ShelfSection } from "../../library/lib/library-types";
import { deriveShelfView, type ShelfCollection } from "./derive-shelf-view";
import { DEFAULT_SHELF_VIEW, type ShelfView } from "./shelf-view";

const t = ((key: string) => key) as unknown as TFunction<"shelf">;
const day = (n: number) => new Date(Date.UTC(2026, 10, n)).toISOString();

function book(id: string, fields: Partial<LibraryBook> = {}): LibraryBook {
  return {
    id,
    title: id,
    author: "Author",
    format: "epub",
    fileName: `${id}.epub`,
    mimeType: "application/epub+zip",
    fileSize: 1,
    coverStatus: "none",
    coverBlobKey: null,
    coverLocal: false,
    coverVersion: null,
    createdAt: day(1),
    updatedAt: day(1),
    lastOpenedAt: null,
    progressPercent: 0,
    readingStatus: "unread",
    progress: null,
    coverUrl: null,
    ...fields,
  };
}
const collection = (
  id: string,
  members: LibraryBook[],
  createdAt = day(1),
  lastOpenedAt: string | null = null,
): ShelfCollection => ({
  collection: { id, name: id, createdAt, lastOpenedAt } satisfies Collection,
  members,
});
const order = (sections: ShelfSection[]) =>
  sections.map((section) => [
    section.label,
    section.entries.map((entry) => (entry.kind === "book" ? entry.book.id : `[${entry.collection.id}]`)),
  ]);
const view = (fields: Partial<ShelfView>): ShelfView => ({ ...DEFAULT_SHELF_VIEW, ...fields });

test("a collection stands among the books where its most recently read member puts it", () => {
  const books = [book("old", { lastOpenedAt: day(2) }), book("new", { lastOpenedAt: day(9) })];
  const members = [book("m-a", { lastOpenedAt: day(3) }), book("m-b", { lastOpenedAt: day(6) })];
  // Empty: placed by when it was made.
  const sections = deriveShelfView(books, [collection("c", members), collection("empty", [], day(4))], view({}), t);
  expect(order(sections)).toEqual([["", ["new", "[c]", "[empty]", "old"]]]);
  // The stack's front cover is the member this view shows first.
  const entry = sections[0].entries[1];
  expect(entry.kind === "collection" && entry.members.map((member) => member.id)).toEqual(["m-b", "m-a"]);
});

test("opening a collection brings it forward, as reading one of its books does", () => {
  const books = [book("read", { lastOpenedAt: day(5) })];
  const members = [book("m", { lastOpenedAt: day(2) })];
  const ids = (opened: string | null) =>
    order(deriveShelfView(books, [collection("c", members, day(1), opened)], view({}), t))[0][1];
  // Never opened: placed by its most recently read member.
  expect(ids(null)).toEqual(["read", "[c]"]);
  // Opened after the book was read: it leads.
  expect(ids(day(8))).toEqual(["[c]", "read"]);
  // An opening older than a member's reading changes nothing.
  expect(ids(day(1))).toEqual(["read", "[c]"]);
  // Empty but opened: placed by the opening, not by when it was made.
  expect(order(deriveShelfView(books, [collection("e", [], day(1), day(9))], view({}), t))[0][1]).toEqual([
    "[e]",
    "read",
  ]);
});

test("every sort places a collection by its own counterpart of the book's key", () => {
  const books = [
    book("Beta", { author: "Zed", createdAt: day(5), progressPercent: 40 }),
    book("Delta", { author: "Abe", createdAt: day(2), progressPercent: 10 }),
  ];
  const shelf = [
    collection("Charlie", [book("m", { progressPercent: 70 }), book("n", { progressPercent: 5 })], day(3)),
  ];
  const ids = (sort: ShelfView["sort"]) => order(deriveShelfView(books, shelf, view({ sort }), t))[0][1];
  expect(ids("title")).toEqual(["Beta", "[Charlie]", "Delta"]);
  // No author: it files under its own name.
  expect(ids("author")).toEqual(["Delta", "[Charlie]", "Beta"]);
  // Added: when the collection was made.
  expect(ids("added")).toEqual(["Beta", "[Charlie]", "Delta"]);
  // Progress: its furthest member.
  expect(ids("progress")).toEqual(["[Charlie]", "Beta", "Delta"]);
});

test("starred books still lead; a collection cannot be starred", () => {
  const books = [book("pinned", { starred: true, lastOpenedAt: day(1) }), book("plain", { lastOpenedAt: day(2) })];
  const shelf = [collection("c", [book("m", { lastOpenedAt: day(9) })])];
  expect(order(deriveShelfView(books, shelf, view({}), t))).toEqual([["", ["pinned", "[c]", "plain"]]]);
});

test("a grouped shelf gives collections a leading section of their own", () => {
  const books = [book("r", { readingStatus: "reading" }), book("f", { readingStatus: "finished" })];
  const shelf = [collection("b", []), collection("a", [], day(9))];
  expect(order(deriveShelfView(books, shelf, view({ group: "status" }), t))).toEqual([
    ["groupSection.collections", ["[a]", "[b]"]],
    ["groupSection.reading", ["r"]],
    ["groupSection.finished", ["f"]],
  ]);
  expect(order(deriveShelfView(books, [], view({ group: "format" }), t))).toEqual([["EPUB", ["r", "f"]]]);
  expect(deriveShelfView([], [], view({}), t)).toEqual([]);
  expect(order(deriveShelfView([], shelf, view({}), t))).toEqual([["", ["[a]", "[b]"]]]);
});
