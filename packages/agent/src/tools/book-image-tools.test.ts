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

test("show_book_image keeps the reading fence and uses a host-derived session guard", async () => {
  const { deps } = createInMemoryDeps(), state = createAgentTurnState();
  state.spoilerFence = { throughChapterIndex: 0, readerChapterIndex: 1 };
  const image = { bookId: "book", contentVersion: "v1", sectionIndex: 0, index: 0 };
  const initial = await deps.reader.getSession();
  deps.reader.getSession = async () => ({ ...initial, status: "ready", sessionId: "current", bookId: "book", revision: 1 });
  const calls: unknown[] = [], signal = new AbortController().signal;
  deps.reader.openImage = async (...args) => { calls.push(args); return { status: "not-opened", reason: "missing" }; };
  const show = buildBookImageTools({ kind: "book", bookId: "book" }, deps, state)[2]!;
  await show.execute("show", { image }, signal);
  expect(calls).toEqual([[{ image, throughChapterIndex: 0 }, signal, { sessionId: "current", bookId: "book" }]]);
  await expect(show.execute("show", { image, confirmSpoiler: true })).rejects.toThrow("not explicitly granted");
  await expect(show.execute("show", { image: { ...image, bookId: "other" } })).rejects.toMatchObject({ code: "memory/forbidden" });
  await expect(show.execute("show", { image, throughChapterIndex: 99 })).rejects.toMatchObject({ code: "library/invalid-query" });
});
