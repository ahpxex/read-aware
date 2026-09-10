import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildBookImageTools } from "./book-image-tools";
import { createAgentTurnState } from "./turn-state";

test("image discovery/acquisition pass the original fence and bind resources to the actual thread", async () => {
  const { deps } = createInMemoryDeps(), state = createAgentTurnState();
  state.spoilerFence = { throughChapterIndex: 0, readerChapterIndex: 1 };
  const image = { bookId: "book", contentVersion: "v1", sectionIndex: 0, index: 0 };
  const calls: unknown[] = [], signal = new AbortController().signal;
  deps.bookText.listImages = async (input, passed) => { calls.push([input, passed]); return { ...image, status: "available", items: [], total: 0, nextOffset: null }; };
  deps.bookText.openImageResource = async (owner, input, passed) => { calls.push([owner, input, passed]); return { status: "missing", image: { image, alt: "" } }; };
  const [list, open] = buildBookImageTools({ kind: "book", bookId: "book" }, deps, state);
  await list!.execute("list", { contentVersion: "v1", sectionIndex: 0 }, signal);
  await open!.execute("open", { image }, signal);
  expect(calls).toEqual([
    [{ bookId: "book", contentVersion: "v1", sectionIndex: 0, offset: 0, limit: 20, throughChapterIndex: 0 }, signal],
    ["book:book", { image, throughChapterIndex: 0 }, signal],
  ]);
  await expect(open!.execute("open", { image, confirmSpoiler: true })).rejects.toThrow("not explicitly granted");
  await expect(open!.execute("open", { image, throughChapterIndex: 100 })).rejects.toMatchObject({ code: "library/invalid-query" });
  await expect(open!.execute("open", { image: { ...image, bookId: "other" } })).rejects.toMatchObject({ code: "memory/forbidden" });
  state.spoilerPermissionGranted = true; await open!.execute("open", { image, confirmSpoiler: true });
  expect(calls[calls.length - 1]).toEqual(["book:book", { image }, undefined]);
  await buildBookImageTools({ kind: "global", threadId: "global" }, deps)[1]!.execute("open", { image });
  expect(calls[calls.length - 1]).toEqual(["global:global", { image }, undefined]);
});
