import { expect, test } from "bun:test";
import { normalizeMemoryPageQuery, type MemoryPageQuery } from "@read-aware/core";
import { seedMemory } from "../testing/fixtures";
import { pageMemoryRows, selectMemoryRows } from "./query-page";

const rows = () => Array.from({ length: 107 }, (_, index) => seedMemory({ id: `m${String(index).padStart(3, "0")}`, scope: "user", content: `Evidence ${index}` }));

test("all matching memories can be paged past 100 with stable ordering and explicit exhaustion", async () => {
  const memories = rows(), ids: string[] = [];
  let input: MemoryPageQuery = { scopes: ["user"], limit: 17 };
  for (;;) {
    const page = await pageMemoryRows([...memories].reverse(), input);
    expect(page.total).toBe(107); expect(page.items.length).toBeLessThanOrEqual(17);
    ids.push(...page.items.map(item => item.id));
    if (page.nextOffset === null) break;
    input = { ...input, offset: page.nextOffset, expectedRevision: page.revision };
  }
  expect(ids).toEqual(memories.map(row => row.id)); expect(new Set(ids).size).toBe(107);
  const empty = await pageMemoryRows([], { scopes: ["user"] });
  expect(empty).toMatchObject({ items: [], total: 0, offset: 0, nextOffset: null });
});

test("revision covers full filtered content and ordering, not just timestamps or the current page", async () => {
  const memories = rows(), first = await pageMemoryRows(memories, { scopes: ["user"], limit: 10 });
  const input: MemoryPageQuery = { scopes: ["user"], offset: 10, expectedRevision: first.revision };
  for (const change of [{ content: "Changed outside the page" }, { evidenceCount: 2 }, { pinned: true }, { status: "forgotten" as const }]) {
    const modified = structuredClone(memories); Object.assign(modified[106]!, change);
    await expect(pageMemoryRows(modified, input)).rejects.toMatchObject({ code: "memory/conflict" });
  }
  await expect(pageMemoryRows(memories.slice(0, 100), input)).rejects.toMatchObject({ code: "memory/conflict" });
  await expect(pageMemoryRows(memories, { ...input, query: "Evidence 10" })).rejects.toMatchObject({ code: "memory/conflict" });
  await expect(pageMemoryRows(memories, { ...input, scopes: ["global"] })).rejects.toMatchObject({ code: "memory/conflict" });
  expect((await pageMemoryRows(memories.reverse(), input)).items[0]!.id).toBe("m010");
});

test("pagination uses the same text matcher and priorities, excludes other scopes and inactive rows", async () => {
  const memories = [
    seedMemory({ id: "normal", scope: "user", content: "Evidence ordinary" }),
    { ...seedMemory({ id: "pinned", scope: "user", content: "Evidence pinned" }), pinned: true, importance: 0.1 },
    seedMemory({ id: "other", scope: "book:other", content: "Evidence private" }),
    { ...seedMemory({ id: "forgotten", scope: "user", content: "Evidence old" }), status: "forgotten" as const },
    seedMemory({ id: "miss", scope: "user", content: "Unrelated" }),
  ];
  const query = { scopes: ["user" as const], query: "evidence argument" };
  const page = await pageMemoryRows(memories, query);
  expect(page.items.map(item => item.id)).toEqual(["pinned", "normal"]);
  expect(page.items.map(item => item.id)).toEqual(selectMemoryRows(memories, query).map(item => item.id));
  const unrelated = await pageMemoryRows([...memories, seedMemory({ id: "x", scope: "book:other", content: "Evidence" })], query);
  expect(unrelated.revision).toBe(page.revision);
});

test("invalid and unpinned continuation cannot bypass page validation; returned records are detached", async () => {
  for (const bad of [null, [], {}, { scopes: [] }, { scopes: ["user"], offset: 1 }, { scopes: ["user"], offset: -1 },
    { scopes: ["user"], expectedRevision: "wrong" }, { scopes: ["user"], offset: null }, { scopes: ["user"], limit: 101 },
    { scopes: ["user"], includeForgotten: true }, { scopes: ["all"] }]) {
    expect(() => normalizeMemoryPageQuery(bad as never)).toThrow();
  }
  const memories = rows(), first = await pageMemoryRows(memories, { scopes: ["user"] });
  first.items[0]!.content = "Consumer mutation";
  expect(memories[0]!.content).toBe("Evidence 0");
  await expect(pageMemoryRows(memories, { scopes: ["user"], offset: 108, expectedRevision: first.revision })).rejects.toMatchObject({ code: "memory/invalid-query" });
  expect((await pageMemoryRows(memories, { scopes: ["user"], offset: 107, expectedRevision: first.revision })).nextOffset).toBeNull();
});
