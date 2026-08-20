import { describe, expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildBookTextTools } from "./book-text-tools";

const BOOK = "status-book" as Id;

function getTocWith(status: "ok" | "unextracted" | "textless" | undefined) {
  const { deps } = createInMemoryDeps({
    books: [{ id: BOOK, title: "Scanned Thing", status: "reading" }],
    chapters: { [BOOK]: [] },
  });
  const bookText = status
    ? { ...deps.bookText, getTextStatus: async () => status }
    : deps.bookText;
  const built = buildBookTextTools({ kind: "book", bookId: BOOK }, { ...deps, bookText });
  return built.find((tool) => tool.name === "get_toc")!;
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.text ?? "";
}

describe("get_toc text-status honesty", () => {
  test("a textless book says so instead of returning a bare empty list", async () => {
    const payload = JSON.parse(text(await getTocWith("textless").execute("t1", {})));
    expect(payload.textStatus).toBe("textless");
    expect(payload.note).toContain("image-only scan");
  });

  test("an unextracted book reports extraction in progress", async () => {
    const payload = JSON.parse(text(await getTocWith("unextracted").execute("t2", {})));
    expect(payload.textStatus).toBe("unextracted");
    expect(payload.note).toContain("not been fully extracted");
  });

  test("hosts without the optional status seam keep the bare empty list", async () => {
    const payload = JSON.parse(text(await getTocWith(undefined).execute("t3", {})));
    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(0);
  });
});
