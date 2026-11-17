import { describe, expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import { createInMemoryDeps, type InMemorySeed } from "../testing/fixtures";
import { buildBookTextTools } from "./book-text-tools";
import { buildModelTools } from "./registry";
import { buildSpoilerAccessTools, SPOILER_ACCESS_TOOL } from "./spoiler-access";
import { createAgentTurnState } from "./turn-state";

const BOOK = "fence-book" as Id;
const scope = { kind: "book", bookId: BOOK } as const;

function setup(fenceAt?: number, seed: Pick<InMemorySeed, "spoilerAccess"> = {}) {
  const { deps, stores } = createInMemoryDeps({
    ...seed,
    books: [{ id: BOOK, title: "Fenced Novel", status: "reading", narrativity: "narrative" }],
    chapters: {
      [BOOK]: [
        { title: "One", text: "safe early text about the harbor lighthouse" },
        { title: "Two", text: "still safe text" },
        { title: "Three", text: "the secret killer is revealed here" },
      ],
    },
  });
  const state = createAgentTurnState();
  if (fenceAt !== undefined) {
    state.spoilerFence = { throughChapterIndex: fenceAt };
    state.spoilerProtected = true;
  }
  const tools = Object.fromEntries(
    [...buildBookTextTools(scope, deps, state), ...buildSpoilerAccessTools(scope, deps, state)].map((tool) => [
      tool.name,
      tool,
    ]),
  );
  return { deps, stores, state, tools };
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.text ?? "";
}

describe("spoiler fence", () => {
  test("read_chapter beyond the fence is refused and names the way to ask", async () => {
    const { read_chapter } = setup(1).tools;
    await expect(read_chapter!.execute("r1", { chapterIndex: 2 })).rejects.toThrow(SPOILER_ACCESS_TOOL);
    expect(text(await read_chapter!.execute("r2", { chapterIndex: 1 }))).toContain("still safe text");
  });

  test("a tool argument opens nothing", async () => {
    const { read_chapter, search_book_text } = setup(1).tools;
    await expect(read_chapter!.execute("r", { chapterIndex: 2, confirmSpoiler: true })).rejects.toThrow(
      "beyond the reader's position",
    );
    const clamped = JSON.parse(
      text(await search_book_text!.execute("s", { queries: ["killer"], confirmSpoiler: true })),
    );
    expect(clamped.totalHits).toBe(0);
  });

  test("a viewport boundary closes the unread remainder of the current chapter", async () => {
    const { read_chapter, search_book_text } = setup(-1).tools;
    await expect(read_chapter!.execute("r-current", { chapterIndex: 0 })).rejects.toThrow(
      "beyond the reader's position",
    );
    const clamped = JSON.parse(text(await search_book_text!.execute("s-current", { queries: ["lighthouse"] })));
    expect(clamped.totalHits).toBe(0);
    expect(clamped.throughChapterIndex).toBe(-1);
  });

  test("no fence means no restrictions, and no card to ask", async () => {
    const { tools } = setup(undefined);
    expect(text(await tools.read_chapter!.execute("r4", { chapterIndex: 2 }))).toContain("secret killer");
    expect(tools[SPOILER_ACCESS_TOOL]).toBeUndefined();
  });
});

describe("request_spoiler_access", () => {
  test("the reader's approval opens every fenced read for the rest of the reply", async () => {
    const { tools, stores, state } = setup(1, { spoilerAccess: "approve" });
    const answer = JSON.parse(text(await tools[SPOILER_ACCESS_TOOL]!.execute("ask", { topic: "who the killer is" })));
    expect(answer.allowed).toBe(true);
    expect(stores.interactions).toEqual([
      expect.objectContaining({ kind: "permission", action: "reveal-spoilers", subject: "who the killer is" }),
    ]);
    expect(state.spoilersAllowed).toBe(true);
    expect(text(await tools.read_chapter!.execute("r", { chapterIndex: 2 }))).toContain("secret killer");
    const open = JSON.parse(text(await tools.search_book_text!.execute("s", { queries: ["killer"] })));
    expect(open.totalHits).toBeGreaterThan(0);
  });

  test("a declined card keeps the fence and is not raised again in the same reply", async () => {
    const { tools, stores, state } = setup(1);
    const first = JSON.parse(text(await tools[SPOILER_ACCESS_TOOL]!.execute("ask", { topic: "the ending" })));
    expect(first.allowed).toBe(false);
    const second = JSON.parse(text(await tools[SPOILER_ACCESS_TOOL]!.execute("again", { topic: "the ending" })));
    expect(second.allowed).toBe(false);
    expect(stores.interactions).toHaveLength(1);
    expect(state.spoilersAllowed).toBe(false);
    await expect(tools.read_chapter!.execute("r", { chapterIndex: 2 })).rejects.toThrow("beyond the reader's position");
  });

  test("the model always holds the card while the book is protected", () => {
    const { deps, state } = setup(1);
    expect(buildModelTools(scope, deps, state).map((tool) => tool.name)).toContain(SPOILER_ACCESS_TOOL);
    state.spoilerProtected = false;
    state.spoilerFence = undefined;
    expect(buildModelTools(scope, deps, state).map((tool) => tool.name)).not.toContain(SPOILER_ACCESS_TOOL);
    expect(
      buildModelTools({ kind: "global", threadId: "g" }, deps, createAgentTurnState()).map((tool) => tool.name),
    ).not.toContain(SPOILER_ACCESS_TOOL);
  });
});
