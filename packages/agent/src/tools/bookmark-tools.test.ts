import { expect, test } from "bun:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Bookmark, Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import type { ThreadScope } from "../thread-scope";
import { buildBookmarkTools } from "./bookmark-tools";

const bookId = "book" as Id;
const at = "2026-09-09T00:00:00Z";
const mark = (id: string, book: string, name: string): Bookmark => ({
  id,
  bookId: book,
  name,
  kind: "location",
  target: { contentVersion: "v1", href: `${id}.xhtml` },
  createdAt: at,
  updatedAt: at,
});
function fixture(scope: ThreadScope = { kind: "book", bookId }) {
  const { deps, stores } = createInMemoryDeps({
    books: [
      { id: bookId, title: "Book" },
      { id: "other" as Id, title: "Other" },
    ],
    bookmarks: [mark("m1", bookId, "Opening duel"), mark("m2", "other", "Elsewhere"), mark("m3", bookId, "The ending")],
  });
  const tools = buildBookmarkTools(scope, deps);
  return { deps, stores, tool: (name: string) => tools.find((tool) => tool.name === name)! };
}
const parsed = (result: AgentToolResult<unknown>) => {
  if (result.content[0]?.type !== "text") throw new Error("Expected text result");
  return JSON.parse(result.content[0].text);
};

test("list_bookmarks defaults to the thread's book and filters by name", async () => {
  const { tool } = fixture();
  const ids = (result: { bookmarks: { id: string }[] }) => result.bookmarks.map((entry) => entry.id);
  expect(ids(parsed(await tool("list_bookmarks").execute("l", {})))).toEqual(["m1", "m3"]);
  expect(ids(parsed(await tool("list_bookmarks").execute("l", { allBooks: true })))).toEqual(["m1", "m2", "m3"]);
  expect(ids(parsed(await tool("list_bookmarks").execute("l", { bookId: "other" })))).toEqual(["m2"]);
  expect(ids(parsed(await tool("list_bookmarks").execute("l", { query: "DUEL" })))).toEqual(["m1"]);
  const global = fixture({ kind: "global", threadId: "global" });
  expect(parsed(await global.tool("list_bookmarks").execute("l", { limit: 1 }))).toMatchObject({
    total: 3,
    truncated: true,
  });
});

test("save_bookmark captures the open reader position", async () => {
  const { deps, stores, tool } = fixture();
  await deps.reader.openBook(bookId);
  const result = parsed(await tool("save_bookmark").execute("s", { kind: "location", name: "  Here  " }));
  expect(result).toMatchObject({ saved: true, bookmark: { bookId, name: "Here", kind: "location" } });
  const saved = stores.bookmarks[stores.bookmarks.length - 1]!;
  const session = await deps.reader.getSession();
  expect(saved.target.contentVersion).toBe(session.location!.contentVersion);
  expect(saved.target).not.toHaveProperty("bookId");
  // Nothing selected: a selection bookmark has nothing to keep.
  await expect(tool("save_bookmark").execute("s", { kind: "selection" })).rejects.toMatchObject({
    code: "bookmarks/invalid-input",
  });
});

test("save_bookmark refuses when no book is open", async () => {
  const { deps, tool } = fixture({ kind: "global", threadId: "global" });
  await deps.reader.close();
  await expect(tool("save_bookmark").execute("s", { kind: "location" })).rejects.toMatchObject({
    code: "reader/no-session",
  });
});

test("manage_bookmark opens, renames, and deletes only with permission", async () => {
  const { deps, stores, tool } = fixture();
  expect(parsed(await tool("manage_bookmark").execute("o", { action: "open", bookmarkId: "m3" }))).toMatchObject({
    opened: true,
  });
  expect((await deps.reader.getSession()).location).toMatchObject({ bookId, href: "m3.xhtml" });
  await tool("manage_bookmark").execute("r", { action: "rename", bookmarkId: "m3", name: "Last page" });
  expect(stores.bookmarks.find((entry) => entry.id === "m3")?.name).toBe("Last page");

  deps.interactions.request = async () => ({ cancelled: true });
  expect(parsed(await tool("manage_bookmark").execute("d", { action: "delete", bookmarkId: "m1" }))).toMatchObject({
    deleted: false,
  });
  expect(stores.bookmarks.some((entry) => entry.id === "m1")).toBe(true);

  const approving = fixture();
  expect(
    parsed(await approving.tool("manage_bookmark").execute("d", { action: "delete", bookmarkId: "m1" })),
  ).toMatchObject({ deleted: true });
  expect(approving.stores.bookmarks.map((entry) => entry.id)).toEqual(["m2", "m3"]);
  expect(approving.stores.interactions).toMatchObject([{ kind: "permission", action: "delete-bookmark" }]);
  await expect(tool("manage_bookmark").execute("x", { action: "open", bookmarkId: "missing" })).rejects.toMatchObject({
    code: "bookmarks/not-found",
  });
});
