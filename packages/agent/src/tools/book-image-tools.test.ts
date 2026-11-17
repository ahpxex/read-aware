import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildBookImageTools } from "./book-image-tools";
import { createAgentTurnState } from "./turn-state";
import { AppError } from "@read-aware/core";

test("stale image sources preserve the error code and give the model an executable discovery step", async () => {
  const { deps } = createInMemoryDeps();
  const stale = new AppError("reader/stale-location", "Book content revision changed");
  const fail = async () => {
    throw stale;
  };
  deps.bookText.listImages = fail;
  deps.bookText.openImageResource = fail;
  deps.bookText.readImageInput = fail;
  deps.reader.openImage = fail;
  const initial = await deps.reader.getSession();
  deps.reader.getSession = async () => ({ ...initial, status: "ready", sessionId: "s", bookId: "book" });
  const image = { bookId: "book", contentVersion: "1.0", sectionIndex: 0, index: 0 };
  for (const scope of [
    { kind: "book", bookId: "book" },
    { kind: "global", threadId: "global" },
  ] as const) {
    for (const tool of buildBookImageTools(scope, deps)) {
      const params =
        tool.name === "list_book_images" ? { bookId: "book", contentVersion: "1.0", sectionIndex: 0 } : { image };
      await expect(tool.execute("stale", params)).rejects.toMatchObject({ code: "reader/stale-location" });
      await expect(tool.execute("stale", params)).rejects.toThrow(
        scope.kind === "book"
          ? 'get_toc with {"view":"navigation"}'
          : 'get_toc with {"bookId":"book","view":"navigation"}',
      );
    }
  }
  const denied = new AppError("memory/forbidden", "Access denied");
  deps.bookText.listImages = async () => {
    throw denied;
  };
  await expect(
    buildBookImageTools({ kind: "book", bookId: "book" }, deps)[0]!.execute("denied", {
      contentVersion: "1.0",
      sectionIndex: 0,
    }),
  ).rejects.toBe(denied);
});

test("image discovery/acquisition pass the original fence and bind resources to the actual thread", async () => {
  const { deps } = createInMemoryDeps(),
    state = createAgentTurnState();
  state.spoilerFence = { throughChapterIndex: 0, readerChapterIndex: 1 };
  const image = { bookId: "book", contentVersion: "v1", sectionIndex: 0, index: 0 };
  const calls: unknown[] = [],
    signal = new AbortController().signal;
  deps.bookText.listImages = async (input, passed) => {
    calls.push([input, passed]);
    return { ...image, status: "available", items: [], total: 0, nextOffset: null };
  };
  deps.bookText.openImageResource = async (owner, input, passed) => {
    calls.push([owner, input, passed]);
    return { status: "missing", image: { image, alt: "" } };
  };
  const [list, open] = buildBookImageTools({ kind: "book", bookId: "book" }, deps, state);
  await list!.execute("list", { contentVersion: "v1", sectionIndex: 0 }, signal);
  await open!.execute("open", { image }, signal);
  expect(calls).toEqual([
    [{ bookId: "book", contentVersion: "v1", sectionIndex: 0, offset: 0, limit: 20, throughChapterIndex: 0 }, signal],
    ["book:book", { image, throughChapterIndex: 0 }, signal],
  ]);
  // An argument carries no permission: it is an unknown field.
  await expect(open!.execute("open", { image, confirmSpoiler: true })).rejects.toMatchObject({
    code: "library/invalid-query",
  });
  await expect(open!.execute("open", { image, throughChapterIndex: 100 })).rejects.toMatchObject({
    code: "library/invalid-query",
  });
  await expect(open!.execute("open", { image: { ...image, bookId: "other" } })).rejects.toMatchObject({
    code: "memory/forbidden",
  });
  state.spoilersAllowed = true;
  await open!.execute("open", { image });
  expect(calls[calls.length - 1]).toEqual(["book:book", { image }, undefined]);
  await buildBookImageTools({ kind: "global", threadId: "global" }, deps)[1]!.execute("open", { image });
  expect(calls[calls.length - 1]).toEqual(["global:global", { image }, undefined]);
});

test("show_book_image keeps the reading fence and uses a host-derived session guard", async () => {
  const { deps } = createInMemoryDeps(),
    state = createAgentTurnState();
  state.spoilerFence = { throughChapterIndex: 0, readerChapterIndex: 1 };
  const image = { bookId: "book", contentVersion: "v1", sectionIndex: 0, index: 0 };
  const initial = await deps.reader.getSession();
  deps.reader.getSession = async () => ({
    ...initial,
    status: "ready",
    sessionId: "current",
    bookId: "book",
    revision: 1,
  });
  const calls: unknown[] = [],
    signal = new AbortController().signal;
  deps.reader.openImage = async (...args) => {
    calls.push(args);
    return { status: "not-opened", reason: "missing" };
  };
  const show = buildBookImageTools({ kind: "book", bookId: "book" }, deps, state)[2]!;
  await show.execute("show", { image }, signal);
  expect(calls).toEqual([[{ image, throughChapterIndex: 0 }, signal, { sessionId: "current", bookId: "book" }]]);
  await expect(show.execute("show", { image, confirmSpoiler: true })).rejects.toMatchObject({
    code: "library/invalid-query",
  });
  await expect(show.execute("show", { image: { ...image, bookId: "other" } })).rejects.toMatchObject({
    code: "memory/forbidden",
  });
  await expect(show.execute("show", { image, throughChapterIndex: 99 })).rejects.toMatchObject({
    code: "library/invalid-query",
  });
});

test("vision tool emits actual bounded image content, enforces reading scope and rejects text-only models", async () => {
  const { deps } = createInMemoryDeps(),
    state = createAgentTurnState();
  state.modelSupportsImages = true;
  state.spoilerFence = { throughChapterIndex: 0 };
  const image = { bookId: "book", contentVersion: "v1", sectionIndex: 0, index: 0 };
  const calls: unknown[] = [];
  deps.bookText.readImageInput = async (...args) => {
    calls.push(args);
    return { status: "ready", image: { image, alt: "" }, input: { mimeType: "image/png", data: "AAAA" } };
  };
  const read = buildBookImageTools({ kind: "book", bookId: "book" }, deps, state).find(
    (tool) => tool.name === "read_book_image",
  )!;
  const result = await read.execute("vision", { image });
  expect(result.content[1]).toEqual({ type: "image", mimeType: "image/png", data: "AAAA" });
  expect(result.content[0]).not.toHaveProperty("data");
  expect(calls[0]).toEqual(["book:book", { image, throughChapterIndex: 0 }, undefined]);
  await expect(read.execute("vision", { image, confirmSpoiler: true })).rejects.toMatchObject({
    code: "library/invalid-query",
  });
  await expect(read.execute("vision", { image: { ...image, bookId: "other" } })).rejects.toMatchObject({
    code: "memory/forbidden",
  });
  for (let i = 0; i < 3; i++) await read.execute("vision", { image });
  // Tool rebuild between requests must not reset the per-turn budget.
  await expect(
    buildBookImageTools({ kind: "book", bookId: "book" }, deps, state)
      .find((tool) => tool.name === "read_book_image")!
      .execute("again", { image }),
  ).rejects.toMatchObject({ code: "ai/image-budget-exceeded" });
  state.modelSupportsImages = false;
  await expect(read.execute("vision", { image })).rejects.toMatchObject({ code: "ai/image-unsupported" });
  expect(calls).toHaveLength(4);
});

test("tool discovery explains why vision is withheld for a text-only model", async () => {
  const { prepareHostTools, toolAvailability } = await import("./tool-availability");
  const { deps } = createInMemoryDeps(),
    state = createAgentTurnState();
  deps.bookText.readImageInput = async () => {
    throw new Error("not expected");
  };
  state.modelSupportsImages = false;
  const scope = { kind: "book" as const, bookId: "book" };
  const prepared = prepareHostTools(buildBookImageTools(scope, deps, state), scope, deps, state);
  expect(prepared.enabled.some((tool) => tool.name === "read_book_image")).toBe(false);
  expect(toolAvailability(prepared.all.find((tool) => tool.name === "read_book_image")!)).toEqual({
    state: "unavailable",
    reason: "model-image-unsupported",
  });
});
