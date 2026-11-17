import { expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import type { BookOverview } from "../ports";
import { createInMemoryDeps } from "../testing/fixtures";
import { BOOK_LIST_DEFAULT_LIMIT, queryBookList } from "./book-list-query";
import { buildThreadTools } from "./library-tools";

const book = (id: string, extra: Partial<BookOverview> = {}): BookOverview => ({ id: id as Id, title: id, ...extra });
const ids = (books: BookOverview[]) => books.map((item) => item.id as string);

const shelf = [
  book("karamazov-old", {
    title: "卡拉马佐夫兄弟",
    author: "陀思妥耶夫斯基",
    fileName: "karamazov (first import).epub",
    fileSize: 4_710_381,
    fileOnDevice: false,
    annotationCount: 13,
    starred: true,
    status: "reading",
    progressPercent: 26,
    addedAt: "2026-07-02T00:00:00Z",
    lastOpenedAt: "2026-09-04T00:00:00Z",
  }),
  book("karamazov-local", {
    title: "卡拉马佐夫兄弟【上海译文】",
    fileName: "karamazov-local.epub",
    fileSize: 4_710_381,
    fileOnDevice: true,
    annotationCount: 0,
    status: "reading",
    progressPercent: 49,
    addedAt: "2026-09-21T00:00:00Z",
    lastOpenedAt: "2026-11-17T00:00:00Z",
  }),
  book("paper", {
    format: "pdf",
    fileSize: 183_788_881,
    fileOnDevice: false,
    collectionId: "papers",
    status: "finished",
  }),
  book("feed", { format: "virtual", progressPercent: 29 }),
  book("unread", { fileOnDevice: true, addedAt: "2026-10-01T00:00:00Z" }),
];

test("no filter returns the shelf as the port gave it, with the total", () => {
  expect(queryBookList(shelf)).toEqual({ books: shelf, total: 5, nextOffset: null });
});

test("books whose file is not on this device are one filter away; a virtual book is neither", () => {
  expect(ids(queryBookList(shelf, { fileOnDevice: false }).books)).toEqual(["karamazov-old", "paper"]);
  expect(ids(queryBookList(shelf, { fileOnDevice: true }).books)).toEqual(["karamazov-local", "unread"]);
});

test("filters combine, and absent fields read as their defaults", () => {
  expect(ids(queryBookList(shelf, { search: "KARAMAZOV" }).books)).toEqual(["karamazov-old", "karamazov-local"]);
  expect(ids(queryBookList(shelf, { search: "陀思妥耶夫斯基" }).books)).toEqual(["karamazov-old"]);
  expect(ids(queryBookList(shelf, { hasAnnotations: true }).books)).toEqual(["karamazov-old"]);
  expect(ids(queryBookList(shelf, { status: "unread" }).books)).toEqual(["feed", "unread"]);
  expect(ids(queryBookList(shelf, { starred: false, fileOnDevice: false }).books)).toEqual(["paper"]);
  expect(ids(queryBookList(shelf, { collectionId: "papers" }).books)).toEqual(["paper"]);
  expect(queryBookList(shelf, { collectionId: null }).total).toBe(4);
  expect(ids(queryBookList(shelf, { format: "pdf" }).books)).toEqual(["paper"]);
});

test("sorting is stable and paging continues where the page ended", () => {
  expect(ids(queryBookList(shelf, { sort: "size" }).books).slice(0, 3)).toEqual([
    "paper",
    "karamazov-local",
    "karamazov-old",
  ]);
  expect(ids(queryBookList(shelf, { sort: "recent" }).books).slice(0, 2)).toEqual(["karamazov-local", "karamazov-old"]);
  expect(ids(queryBookList(shelf, { sort: "progress" }).books)[0]).toBe("karamazov-local");
  const first = queryBookList(shelf, { sort: "title", limit: 2 });
  expect(first).toMatchObject({ total: 5, nextOffset: 2 });
  const rest = queryBookList(shelf, { sort: "title", limit: 2, offset: first.nextOffset! });
  expect(rest.nextOffset).toBe(4);
  expect(new Set([...ids(first.books), ...ids(rest.books)]).size).toBe(4);
});

test("a shelf larger than one page is bounded by default", () => {
  const large = Array.from({ length: BOOK_LIST_DEFAULT_LIMIT + 5 }, (_, i) => book(`b${i}`));
  expect(queryBookList(large)).toMatchObject({ total: large.length, nextOffset: BOOK_LIST_DEFAULT_LIMIT });
});

test("list_books carries file facts and applies the filters it is given", async () => {
  const { deps } = createInMemoryDeps({ books: shelf });
  const tool = buildThreadTools({ kind: "global", threadId: "t" }, deps).find((item) => item.name === "list_books")!;
  const run = async (input: object) =>
    JSON.parse(((await tool.execute("list", input)).content[0] as { text: string }).text) as {
      books: BookOverview[];
      total: number;
    };
  const all = await run({});
  expect(all.total).toBe(5);
  expect(all.books[0]).toMatchObject({ fileSize: 4_710_381, fileOnDevice: false, annotationCount: 13 });
  expect(all.books[0]).not.toHaveProperty("fileName");
  expect(ids((await run({ search: "first import" })).books)).toEqual(["karamazov-old"]);
  expect(ids((await run({ fileOnDevice: false, hasAnnotations: true })).books)).toEqual(["karamazov-old"]);
});
