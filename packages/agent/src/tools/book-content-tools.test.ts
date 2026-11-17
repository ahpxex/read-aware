import { expect, test } from "bun:test";
import { AppError, type Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildBookContentTools } from "./book-content-tools";

test("both tool scopes use the content-state port with exact book scope, cancellation and no inferred readiness", async () => {
  const { deps } = createInMemoryDeps({ books: [{ id: "book" as Id, title: "Book" }] });
  const abort = new AbortController();
  let calls = 0;
  deps.library.getContentState = async (bookId, signal) => {
    expect(bookId).toBe("book");
    expect(signal).toBe(abort.signal);
    calls++;
    return {
      bookId,
      source: "virtual",
      availability: "provider-registered",
      sourceRevision: "opaque",
      contentVersion: null,
    };
  };
  const book = buildBookContentTools({ kind: "book", bookId: "book" as Id }, deps)[0]!;
  const global = buildBookContentTools({ kind: "global", threadId: "thread" }, deps)[0]!;
  for (const [tool, input] of [
    [book, {}],
    [global, { bookId: "book" }],
  ] as const) {
    const result = await tool.execute("state", input, abort.signal);
    expect(result.content[0]).toMatchObject({ type: "text" });
    if (result.content[0]?.type === "text")
      expect(JSON.parse(result.content[0].text)).toMatchObject({
        availability: "provider-registered",
        contentVersion: null,
      });
  }
  await expect(book.execute("state", { bookId: "other" })).rejects.toMatchObject({ code: "memory/forbidden" });
  await expect(global.execute("state", {})).rejects.toMatchObject({ code: "ui/invalid-target" });
  deps.library.getContentState = async () => {
    abort.abort(new AppError("plugin/cancelled", "retired"));
    return { bookId: "book", source: "file", availability: "missing", sourceRevision: "missing", contentVersion: null };
  };
  await expect(book.execute("state", {}, abort.signal)).rejects.toMatchObject({ code: "plugin/cancelled" });
  expect(calls).toBe(2);
});

test("file checks cover the shelf's missing files globally and exactly one book in a book conversation", async () => {
  const { deps } = createInMemoryDeps({
    books: [
      { id: "here" as Id, title: "Here", fileOnDevice: true },
      { id: "entry-only" as Id, title: "Entry only", fileOnDevice: false },
      { id: "feed" as Id, title: "Feed", format: "virtual" },
    ],
  });
  const find = (tools: ReturnType<typeof buildBookContentTools>) =>
    tools.find((tool) => tool.name === "check_book_files")!;
  const read = async (tool: ReturnType<typeof find>, input: object) => {
    const result = await tool.execute("check", input);
    return JSON.parse((result.content[0] as { text: string }).text) as {
      checks: Array<{ bookId: string; title: string; file: { state: string; reason?: string } }>;
      remaining: number;
    };
  };
  const global = find(buildBookContentTools({ kind: "global", threadId: "thread" }, deps));
  // No ids: only the books whose file is not on this device, never the whole shelf.
  expect((await read(global, {})).checks).toEqual([
    { bookId: "entry-only", title: "Entry only", file: { state: "unknown", reason: "no-sync" } },
  ]);
  expect((await read(global, { bookIds: ["here", "feed"] })).checks.map((check) => check.file.state)).toEqual([
    "on-device",
    "virtual",
  ]);
  await expect(global.execute("check", { bookIds: ["absent"] })).rejects.toMatchObject({
    code: "library/book-not-found",
  });
  const book = find(buildBookContentTools({ kind: "book", bookId: "entry-only" as Id }, deps));
  expect((await read(book, {})).checks.map((check) => check.bookId)).toEqual(["entry-only"]);
  await expect(book.execute("check", { bookIds: ["here"] })).rejects.toMatchObject({ code: "memory/forbidden" });
});
