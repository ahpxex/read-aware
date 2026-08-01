import { describe, expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildShelfTools } from "./shelf-tools";

describe("destructive shelf tools", () => {
  test("delete_book cannot mutate storage when permission is declined", async () => {
    const { deps, stores } = createInMemoryDeps({
      books: [{ id: "book-1", title: "The Book" }],
    });
    deps.interactions.request = async (request) => {
      stores.interactions.push(request);
      return { optionId: "decline", text: "Declined" };
    };
    const tool = buildShelfTools({ kind: "global", threadId: "thread-1" }, deps).find(
      (candidate) => candidate.name === "delete_book",
    );
    if (!tool) throw new Error("delete_book was not registered");

    const result = await tool.execute("delete-1", { bookId: "book-1" });

    expect(stores.books.map((book) => book.id)).toEqual(["book-1"]);
    expect(stores.interactions[0]).toMatchObject({
      kind: "permission",
      action: "delete-book",
      subject: "The Book",
    });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: JSON.stringify({ deleted: false, reason: "User declined." }),
    });
  });

  test("delete_book mutates only after explicit approval", async () => {
    const { deps, stores } = createInMemoryDeps({
      books: [{ id: "book-1", title: "The Book" }],
    });
    const tool = buildShelfTools({ kind: "book", bookId: "book-1" }, deps).find(
      (candidate) => candidate.name === "delete_book",
    );
    if (!tool) throw new Error("delete_book was not registered");

    await tool.execute("delete-2", {});

    expect(stores.interactions[0]).toMatchObject({ kind: "permission", action: "delete-book" });
    expect(stores.books).toHaveLength(0);
  });
});
