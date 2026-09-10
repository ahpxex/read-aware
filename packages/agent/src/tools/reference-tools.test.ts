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
  expect(buildReferenceTools({ kind: "global", threadId: "global" }, deps).map(tool => tool.name)).toEqual(["list_book_references", "read_book_reference"]);
});
