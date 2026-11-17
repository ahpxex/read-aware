import { describe, expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildBookTextTools } from "./book-text-tools";

const BOOK = "status-book" as Id;

type TextState = Awaited<
  ReturnType<NonNullable<ReturnType<typeof createInMemoryDeps>["deps"]["bookText"]["getTextState"]>>
>;

function getTocWith(state: Pick<TextState, "status" | "text"> | undefined) {
  const { deps } = createInMemoryDeps({
    books: [{ id: BOOK, title: "Scanned Thing", status: "reading" }],
    chapters: { [BOOK]: [] },
  });
  const bookText = {
    ...deps.bookText,
    getTextState: state
      ? async (): Promise<TextState> => ({
          bookId: BOOK,
          contentVersion: "sha256:test",
          chapterCount: 0,
          progress: { total: 1, completed: 1, failed: 0, unsupported: 0 },
          ...state,
        })
      : undefined,
  };
  const built = buildBookTextTools({ kind: "book", bookId: BOOK }, { ...deps, bookText });
  return built.find((tool) => tool.name === "get_toc")!;
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.text ?? "";
}

describe("get_toc text-state honesty", () => {
  test("a textless book says so instead of returning a bare empty list", async () => {
    const payload = JSON.parse(text(await getTocWith({ status: "ready", text: "textless" }).execute("t1", {})));
    expect(payload.textState.text).toBe("textless");
    expect(payload.note).toContain("no extractable text");
  });

  test("a book still being prepared reports it", async () => {
    const payload = JSON.parse(text(await getTocWith({ status: "preparing", text: "unknown" }).execute("t2", {})));
    expect(payload.textState.status).toBe("preparing");
    expect(payload.note).toContain("Text preparation is running");
  });

  test("hosts without the text-state seam keep the bare empty list", async () => {
    const payload = JSON.parse(text(await getTocWith(undefined).execute("t3", {})));
    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(0);
  });
});

test("the explicit status tool works in both scopes and never triggers extraction", async () => {
  const { deps } = createInMemoryDeps();
  let statusReads = 0;
  const state = {
    bookId: BOOK,
    contentVersion: "sha256:test",
    status: "preparing" as const,
    text: "unknown" as const,
    chapterCount: 0,
    progress: { total: 9, completed: 2, failed: 1, unsupported: 0 },
  };
  const bookText = {
    ...deps.bookText,
    getToc: async () => {
      throw Error("must not extract");
    },
    getTextState: async (id: Id) => {
      expect(id).toBe(BOOK);
      statusReads++;
      return state;
    },
  };
  for (const scope of [
    { kind: "book" as const, bookId: BOOK },
    { kind: "global" as const, threadId: "status-test" },
  ]) {
    const tool = buildBookTextTools(scope, { ...deps, bookText }).find((tool) => tool.name === "get_book_text_status")!;
    expect(JSON.parse(text(await tool.execute("status", scope.kind === "book" ? {} : { bookId: BOOK })))).toEqual(
      state,
    );
  }
  expect(statusReads).toBe(2);
});

test("empty TOC preserves failed, unsupported, short-text and preparing distinctions", async () => {
  const { deps } = createInMemoryDeps();
  for (const [status, textPresence] of [
    ["partial", "available"],
    ["error", "unknown"],
    ["unsupported", "unknown"],
    ["preparing", "unknown"],
    ["ready", "available"],
  ] as const) {
    const tools = buildBookTextTools(
      { kind: "book", bookId: BOOK },
      {
        ...deps,
        bookText: {
          ...deps.bookText,
          getToc: async () => [],
          getTextState: async () => ({
            bookId: BOOK,
            contentVersion: "v",
            status,
            text: textPresence,
            chapterCount: 0,
            progress: null,
            errorCode: "db/locked",
          }),
        },
      },
    );
    const run = tools.find((tool) => tool.name === "get_toc")!.execute("toc", {});
    if (status === "partial" || status === "error") await expect(run).rejects.toMatchObject({ code: "db/locked" });
    else expect(JSON.parse(text(await run)).textState).toMatchObject({ status, text: textPresence });
  }
});

test("a status read failure is not converted into an empty TOC", async () => {
  const { deps } = createInMemoryDeps();
  const error = Object.assign(new Error("read failed"), { code: "db/locked" });
  const tools = buildBookTextTools(
    { kind: "book", bookId: BOOK },
    {
      ...deps,
      bookText: {
        ...deps.bookText,
        getToc: async () => [],
        getTextState: async () => {
          throw error;
        },
      },
    },
  );
  await expect(tools.find((tool) => tool.name === "get_toc")!.execute("toc", {})).rejects.toBe(error);
});
