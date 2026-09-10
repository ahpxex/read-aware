import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildReferenceTools } from "./reference-tools";
import { createAgentTurnState } from "./turn-state";

const reference = { bookId: "book", contentVersion: "v1", sectionIndex: 0, index: 0 };
test("both reference tools preserve the original fence, signal and bounded evidence", async () => {
  const { deps } = createInMemoryDeps();
  const state = createAgentTurnState();
  state.spoilerFence = { throughChapterIndex: 0, readerChapterIndex: 1 };
  const calls: unknown[] = [], signal = new AbortController().signal;
  deps.bookText.listReferences = async (input, passed) => { calls.push([input, passed]); return { ...reference, status: "available", items: [], total: 0, nextOffset: null }; };
  deps.bookText.readReference = async (input, passed) => { calls.push([input, passed]); return { reference, status: "resolved", label: "1", text: "Note", offset: 0, totalLength: 4, nextOffset: null }; };
  const tools = buildReferenceTools({ kind: "book", bookId: "book" }, deps, state);
  await tools[0].execute("list", { contentVersion: "v1", sectionIndex: 0 }, signal);
  await tools[1].execute("read", { reference }, signal);
  expect(calls).toEqual([
    [{ bookId: "book", contentVersion: "v1", sectionIndex: 0, limit: 20, offset: 0, throughChapterIndex: 0 }, signal],
    [{ reference, limit: 4000, offset: 0, throughChapterIndex: 0 }, signal],
  ]);
  expect(state.evidenceTexts).toEqual(["Note"]);
  await expect(tools[1].execute("read", { reference, confirmSpoiler: true })).rejects.toThrow("not explicitly granted");
  await expect(tools[1].execute("read", { reference, throughChapterIndex: 100 })).rejects.toMatchObject({ code: "library/invalid-query" });
  state.spoilerPermissionGranted = true;
  await tools[1].execute("read", { reference, confirmSpoiler: true });
  expect(calls[2]).toEqual([{ reference, offset: 0, limit: 4000 }, undefined]);
  expect(state.spoilerGranted).toBe(true);
  expect(buildReferenceTools({ kind: "global", threadId: "global" }, deps).map(tool => tool.name)).toEqual(["list_book_references", "read_book_reference", "show_book_reference", "close_book_reference"]);
});

test("native preview tools bind ownership to the thread and pass the same source fence", async () => {
  const { deps } = createInMemoryDeps({ books: [{ id: "book", title: "Book" }] });
  const state = createAgentTurnState();
  state.spoilerFence = { throughChapterIndex: 0, readerChapterIndex: 1 };
  const signal = new AbortController().signal;
  let actual: unknown;
  deps.reader.previewReference = async (owner, input, passed, guard) => {
    actual = { owner, input, passed, guard };
    return { status: "opened", id: "preview", sessionId: "fixture", preview: { reference, status: "resolved", label: "Note", text: "Shown",
      offset: 0, totalLength: 5, nextOffset: null } };
  };
  let closed: unknown;
  deps.reader.closeReferencePreview = async (owner, id, passed) => { closed = { owner, id, passed }; return { status: "closed", id }; };
  const tools = buildReferenceTools({ kind: "book", bookId: "book" }, deps, state);
  await tools.find(tool => tool.name === "show_book_reference")!.execute("show", { reference }, signal);
  expect(actual).toEqual({ owner: "book:book", input: { reference, offset: 0, limit: 4000, throughChapterIndex: 0 }, passed: signal,
    guard: { bookId: "book", sessionId: "fixture" } });
  expect(state.evidenceTexts).toEqual(["Shown"]);
  await tools.find(tool => tool.name === "close_book_reference")!.execute("close", { id: "preview" }, signal);
  expect(closed).toEqual({ owner: "book:book", id: "preview", passed: signal });
  await expect(tools.find(tool => tool.name === "show_book_reference")!.execute("show", { reference, confirmSpoiler: true })).rejects.toThrow("not explicitly granted");
});
