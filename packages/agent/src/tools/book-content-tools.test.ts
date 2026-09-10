import { expect, test } from "bun:test";
import { AppError, type Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildBookContentTools } from "./book-content-tools";

test("both tool scopes use the content-state port with exact book scope, cancellation and no inferred readiness", async () => {
  const { deps } = createInMemoryDeps({ books: [{ id: "book" as Id, title: "Book" }] });
  const abort = new AbortController(); let calls = 0;
  deps.library.getContentState = async (bookId, signal) => {
    expect(bookId).toBe("book"); expect(signal).toBe(abort.signal); calls++;
    return { bookId, source: "virtual", availability: "provider-registered", sourceRevision: "opaque", contentVersion: null };
  };
  const book = buildBookContentTools({ kind: "book", bookId: "book" as Id }, deps)[0]!;
  const global = buildBookContentTools({ kind: "global", threadId: "thread" }, deps)[0]!;
  for (const [tool, input] of [[book, {}], [global, { bookId: "book" }]] as const) {
    const result = await tool.execute("state", input, abort.signal);
    expect(result.content[0]).toMatchObject({ type: "text" });
    if (result.content[0]?.type === "text") expect(JSON.parse(result.content[0].text)).toMatchObject({ availability: "provider-registered", contentVersion: null });
  }
  await expect(book.execute("state", { bookId: "other" })).rejects.toMatchObject({ code: "memory/forbidden" });
  await expect(global.execute("state", {})).rejects.toMatchObject({ code: "ui/invalid-target" });
  deps.library.getContentState = async () => { abort.abort(new AppError("plugin/cancelled", "retired")); return { bookId: "book", source: "file", availability: "missing", sourceRevision: "missing", contentVersion: null }; };
  await expect(book.execute("state", {}, abort.signal)).rejects.toMatchObject({ code: "plugin/cancelled" });
  expect(calls).toBe(2);
});
