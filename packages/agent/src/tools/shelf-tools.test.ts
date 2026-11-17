import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildShelfTools } from "./shelf-tools";

test("blank titles reject before any other requested shelf mutation in either scope", async () => {
  for (const scope of [
    { kind: "global", threadId: "shelf-test" },
    { kind: "book", bookId: "book" },
  ] as const) {
    const { deps, stores } = createInMemoryDeps({ books: [{ id: "book", title: "Original", starred: false }] });
    const tool = buildShelfTools(scope, deps).find((tool) => tool.name === "update_book")!;
    await expect(tool.execute("blank", { bookId: "book", title: " \n\t ", starred: true })).rejects.toMatchObject({
      code: "ui/invalid-target",
    });
    expect(stores.books[0]).toMatchObject({ title: "Original", starred: false });
  }
});

test("update receipts report the re-read values, including host normalization or ignored writes", async () => {
  const { deps } = createInMemoryDeps({ books: [{ id: "book", title: "Original", author: "Old", starred: false }] });
  const tool = buildShelfTools({ kind: "book", bookId: "book" }, deps).find((tool) => tool.name === "update_book")!;
  const result = await tool.execute("trimmed", { title: "  中文书名  ", author: "  作者  ", starred: true });
  expect(result.content[0]).toMatchObject({
    text: JSON.stringify({ updated: true, bookId: "book", title: "中文书名", author: "作者", starred: true }),
  });
  deps.library.editBookMetadata = async () => {};
  const ignored = await tool.execute("ignored", { title: "Not persisted" });
  expect(ignored.content[0]).toMatchObject({
    text: JSON.stringify({ updated: false, bookId: "book", title: "中文书名" }),
  });
});

test("several books are starred or finished in one call, with a receipt per book", async () => {
  const { deps, stores } = createInMemoryDeps({
    books: [
      { id: "a", title: "A", starred: false },
      { id: "b", title: "B", starred: false },
      { id: "c", title: "C", starred: true },
    ],
  });
  const tool = buildShelfTools({ kind: "global", threadId: "shelf-test" }, deps).find(
    (tool) => tool.name === "update_book",
  )!;
  const read = async (input: object) =>
    JSON.parse(((await tool.execute("batch", input)).content[0] as { text: string }).text);
  expect(await read({ bookIds: ["a", "b", "a"], starred: true, finished: true })).toEqual({
    updated: 2,
    requested: 2,
    books: [
      { bookId: "a", starred: true, finished: true },
      { bookId: "b", starred: true, finished: true },
    ],
  });
  expect(stores.books.map((book) => book.starred)).toEqual([true, true, true]);

  // An unknown id stops the whole call before any book changes.
  await expect(tool.execute("unknown", { bookIds: ["a", "ghost"], starred: false })).rejects.toMatchObject({
    code: "library/book-not-found",
  });
  expect(stores.books[0]!.starred).toBe(true);
  for (const input of [
    { bookIds: ["a"], title: "Renamed" },
    { bookIds: ["a"], bookId: "b", starred: true },
  ])
    await expect(tool.execute("invalid", input)).rejects.toMatchObject({ code: "ui/invalid-target" });

  // One book failing is reported; the others still change.
  const setStarred = deps.library.setBookStarred;
  deps.library.setBookStarred = async (bookId, starred) => {
    if (bookId === "b") throw Object.assign(new Error("locked"), { code: "db/locked" });
    return setStarred(bookId, starred);
  };
  expect(await read({ bookIds: ["a", "b", "c"], starred: false })).toEqual({
    updated: 2,
    requested: 3,
    books: [
      { bookId: "a", starred: false },
      { bookId: "b", starred: true },
      { bookId: "c", starred: false },
    ],
    failed: [{ bookId: "b", errorCode: "db/locked" }],
  });
});

test("a book conversation updates only its own book", async () => {
  const { deps } = createInMemoryDeps({ books: [{ id: "book", title: "Book" }] });
  const tool = buildShelfTools({ kind: "book", bookId: "book" }, deps).find((tool) => tool.name === "update_book")!;
  expect(JSON.stringify(tool.parameters)).not.toContain("bookIds");
});
