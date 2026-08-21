import { describe, expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildBookTextTools } from "./book-text-tools";
import { createAgentTurnState } from "./turn-state";

const BOOK = "fence-book" as Id;

function tools(fenceAt?: number, permissionGranted = false) {
  const { deps } = createInMemoryDeps({
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
  state.spoilerPermissionGranted = permissionGranted;
  if (fenceAt !== undefined) state.spoilerFence = { throughChapterIndex: fenceAt };
  const built = buildBookTextTools({ kind: "book", bookId: BOOK }, deps, state);
  const byName = Object.fromEntries(built.map((tool) => [tool.name, tool]));
  return byName;
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.text ?? "";
}

describe("spoiler fence", () => {
  test("read_chapter beyond the fence is blocked with a retryable instruction", async () => {
    const { read_chapter } = tools(1);
    await expect(read_chapter!.execute("r1", { chapterIndex: 2 })).rejects.toThrow(
      "beyond the reader's position",
    );
    const within = await read_chapter!.execute("r2", { chapterIndex: 1 });
    expect(text(within)).toContain("still safe text");
  });

  test("confirmSpoiler lifts the fence for an explicit grant", async () => {
    const { read_chapter } = tools(1, true);
    const beyond = await read_chapter!.execute("r3", { chapterIndex: 2, confirmSpoiler: true });
    expect(text(beyond)).toContain("secret killer");
  });

  test("a model cannot create spoiler permission with its tool argument", async () => {
    const { read_chapter, search_book_text } = tools(1);
    await expect(
      read_chapter!.execute("r-denied", { chapterIndex: 2, confirmSpoiler: true }),
    ).rejects.toThrow("reader has not explicitly granted spoiler permission");
    await expect(
      search_book_text!.execute("s-denied", { queries: ["killer"], confirmSpoiler: true }),
    ).rejects.toThrow("reader has not explicitly granted spoiler permission");
  });

  test("a viewport boundary blocks the unread remainder of the current chapter", async () => {
    const { read_chapter, search_book_text } = tools(-1);
    await expect(read_chapter!.execute("r-current", { chapterIndex: 0 })).rejects.toThrow(
      "viewport boundary",
    );
    const clamped = JSON.parse(
      text(await search_book_text!.execute("s-current", { queries: ["lighthouse"] })),
    );
    expect(clamped.totalHits).toBe(0);
    expect(clamped.throughChapterIndex).toBe(-1);
  });

  test("search is silently clamped to the fence, and unclamped with the grant", async () => {
    const { search_book_text } = tools(1, true);
    const clamped = JSON.parse(text(await search_book_text!.execute("s1", { queries: ["killer"] })));
    expect(clamped.totalHits).toBe(0);
    expect(clamped.throughChapterIndex).toBe(1);
    const granted = JSON.parse(
      text(await search_book_text!.execute("s2", { queries: ["killer"], confirmSpoiler: true })),
    );
    expect(granted.totalHits).toBeGreaterThan(0);
  });

  test("no fence means no restrictions", async () => {
    const { read_chapter, search_book_text } = tools(undefined);
    expect(text(await read_chapter!.execute("r4", { chapterIndex: 2 }))).toContain("secret killer");
    const open = JSON.parse(text(await search_book_text!.execute("s3", { queries: ["killer"] })));
    expect(open.totalHits).toBeGreaterThan(0);
  });
});
