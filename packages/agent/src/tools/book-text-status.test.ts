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
  const bookText = { ...deps.bookText, getTextState: undefined, ...(status ? { getTextStatus: async () => status } : {}) };
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

test("the explicit status tool works in both scopes and never triggers extraction", async () => {
  const { deps } = createInMemoryDeps();
  let statusReads = 0;
  const state = { bookId: BOOK, contentVersion: "sha256:test", status: "preparing" as const, text: "unknown" as const, chapterCount: 0,
    progress: { total: 9, completed: 2, failed: 1, unsupported: 0 } };
  const bookText = { ...deps.bookText, getToc: async () => { throw Error("must not extract"); },
    getTextState: async (id: Id) => { expect(id).toBe(BOOK); statusReads++; return state; } };
  for (const scope of [{ kind: "book" as const, bookId: BOOK }, { kind: "global" as const, threadId: "status-test" }]) {
    const tool = buildBookTextTools(scope, { ...deps, bookText }).find(tool => tool.name === "get_book_text_status")!;
    expect(JSON.parse(text(await tool.execute("status", scope.kind === "book" ? {} : { bookId: BOOK })))).toEqual(state);
  }
  expect(statusReads).toBe(2);
});

test("empty TOC preserves failed, unsupported, short-text and preparing distinctions", async () => {
  const { deps } = createInMemoryDeps();
  for (const [status, textPresence] of [["partial", "available"], ["error", "unknown"], ["unsupported", "unknown"], ["preparing", "unknown"], ["ready", "available"]] as const) {
    const tools = buildBookTextTools({ kind: "book", bookId: BOOK }, { ...deps, bookText: { ...deps.bookText,
      getToc: async () => [], getTextState: async () => ({ bookId: BOOK, contentVersion: "v", status, text: textPresence, chapterCount: 0, progress: null, errorCode: "db/locked" }),
    } });
    const run = tools.find(tool => tool.name === "get_toc")!.execute("toc", {});
    if (status === "partial" || status === "error") await expect(run).rejects.toMatchObject({ code: "db/locked" });
    else expect(JSON.parse(text(await run)).textState).toMatchObject({ status, text: textPresence });
  }
});

test("a status read failure is not converted into an empty TOC", async () => {
  const { deps } = createInMemoryDeps();
  const error = Object.assign(new Error("read failed"), { code: "db/locked" });
  const tools = buildBookTextTools({ kind: "book", bookId: BOOK }, { ...deps, bookText: { ...deps.bookText,
    getTextState: undefined, getToc: async () => [], getTextStatus: async () => { throw error; },
  } });
  await expect(tools.find(tool => tool.name === "get_toc")!.execute("toc", {})).rejects.toBe(error);
});
