import { expect, test } from "bun:test";
import type { MemoryPage } from "@read-aware/core";
import { createInMemoryDeps, seedMemory } from "../testing/fixtures";
import { buildMemoryTools } from "./memory-tools";

test("search_memory continues with the returned revision and rejects changed results", async () => {
  const f = createInMemoryDeps({ memories: Array.from({ length: 41 }, (_, index) => seedMemory({ id: String(index), scope: "user", content: `Memory ${index}` })) });
  const tool = buildMemoryTools({ kind: "global", threadId: "test" }, f.deps).find(tool => tool.name === "search_memory")!;
  const search = async (params: unknown): Promise<MemoryPage> => {
    const result = await tool.execute("page", params);
    if (result.content[0]?.type !== "text") throw Error("Expected text");
    return JSON.parse(result.content[0].text);
  };
  const first = await search({}); expect(first.items).toHaveLength(20); expect(first.total).toBe(41);
  const second = await search({ offset: first.nextOffset, expectedRevision: first.revision });
  expect(second.items).toHaveLength(20);
  expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(40);
  f.stores.memories[0]!.content = "changed";
  await expect(search({ offset: second.nextOffset, expectedRevision: second.revision })).rejects.toMatchObject({ code: "memory/conflict" });
});

test("global book filters and book-thread boundaries are preserved across pages", async () => {
  const f = createInMemoryDeps({ memories: [seedMemory({ id: "private", scope: "book:other", content: "Other book" }), seedMemory({ id: "current", scope: "book:current", content: "Current book" })] });
  const global = buildMemoryTools({ kind: "global", threadId: "test" }, f.deps).find(tool => tool.name === "search_memory")!;
  expect(JSON.stringify(await global.execute("global", { bookId: "other" }))).toContain("Other book");
  const book = buildMemoryTools({ kind: "book", bookId: "current" as never }, f.deps).find(tool => tool.name === "search_memory")!;
  expect(JSON.stringify(await book.execute("book", {}))).not.toContain("Other book");
  for (const input of [{ bookId: "other" }, { scopes: ["book:other"] }, { offset: 20 }, { limit: 0 }, { bookId: null }]) {
    await expect(book.execute("invalid", input)).rejects.toMatchObject({ code: "memory/invalid-query" });
  }
});
