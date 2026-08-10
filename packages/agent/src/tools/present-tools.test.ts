import { describe, expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildPresentTools, createPresentTurnState, referenceFromToolDetails } from "./present-tools";

function resultJson(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const content = result.content[0];
  if (!content || content.type !== "text" || !content.text) throw new Error("expected text");
  return JSON.parse(content.text);
}

describe("present_books turn dedupe", () => {
  test("a book already presented this turn is dropped, not re-rendered", async () => {
    const { deps } = createInMemoryDeps({
      books: [
        { id: "book-1", title: "One" },
        { id: "book-2", title: "Two" },
      ],
    });
    const state = createPresentTurnState();
    const tool = buildPresentTools(deps, state)[0]!;

    const first = await tool.execute("p1", { bookIds: ["book-1"] });
    expect(resultJson(first)).toMatchObject({ presented: ["book-1"] });
    expect(referenceFromToolDetails(first.details)).toBeDefined();

    const second = await tool.execute("p2", { bookIds: ["book-1", "book-2"] });
    expect(resultJson(second)).toMatchObject({
      presented: ["book-2"],
      skippedRepeat: ["book-1"],
    });
    const reference = referenceFromToolDetails(second.details);
    expect(reference?.kind === "books" && reference.books.map((b) => b.bookId)).toEqual(["book-2"]);
  });

  test("clearing the turn state re-allows presentation next turn", async () => {
    const { deps } = createInMemoryDeps({ books: [{ id: "book-1", title: "One" }] });
    const state = createPresentTurnState();
    const tool = buildPresentTools(deps, state)[0]!;
    await tool.execute("p1", { bookIds: ["book-1"] });
    state.presentedBookIds.clear();
    const again = await tool.execute("p2", { bookIds: ["book-1"] });
    expect(resultJson(again)).toMatchObject({ presented: ["book-1"] });
  });

  test("without turn state the tool behaves as before", async () => {
    const { deps } = createInMemoryDeps({ books: [{ id: "book-1", title: "One" }] });
    const tool = buildPresentTools(deps)[0]!;
    const result = await tool.execute("p1", { bookIds: ["book-1"] });
    expect(resultJson(result)).toMatchObject({ presented: ["book-1"] });
  });
});
