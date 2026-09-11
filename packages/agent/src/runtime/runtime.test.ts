import { describe, expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import { createInMemoryDeps, seedMemory } from "../testing/fixtures";
import { createAgentRuntime } from "./runtime";

function makeRuntime(fixture = createInMemoryDeps(), now?: () => number) {
  const { deps, stores } = fixture;
  let memoryLists = 0;
  const snapshotMemories = deps.memory.snapshotMemories;
  deps.memory.snapshotMemories = async () => {
    memoryLists += 1;
    return snapshotMemories();
  };
  const runtime = createAgentRuntime({
    deps,
    account: { kind: "api-key", provider: "openai", apiKey: "test-key" },
    models: { smart: "test-smart", fast: "test-fast" },
    now,
  });
  return { runtime, stores, memoryLists: () => memoryLists };
}

describe("AgentRuntime maintenance", () => {
  test("idle consolidation runs once while memory stays unchanged", async () => {
    const { runtime, memoryLists } = makeRuntime();

    expect(await runtime.consolidateIfNeeded()).not.toBeNull();
    expect(await runtime.consolidateIfNeeded()).toBeNull();
    expect(memoryLists()).toBe(6); // Identity source capture and fixture commit checks also read memories.

    await runtime.consolidate();
    expect(memoryLists()).toBe(8);
  });

  test("external insert, correction and forgetting invalidate the durable checkpoint", async () => {
    const fixture = createInMemoryDeps();
    const { runtime } = makeRuntime(fixture);
    await runtime.consolidateIfNeeded();
    expect(await runtime.consolidateIfNeeded()).toBeNull();
    const saved = await fixture.deps.memory.saveMemory({ scope: "user", kind: "fact", content: "External", origin: "plugin", sourceThreadKey: "global" });
    expect(await runtime.consolidateIfNeeded()).not.toBeNull();
    let snapshot = (await fixture.deps.memoryManagement.inspect(saved.id))!;
    await fixture.deps.memoryManagement.mutate({ op: "correct", memoryId: saved.id, expectedRevision: snapshot.revision, content: "User correction" });
    expect(await runtime.consolidateIfNeeded()).not.toBeNull();
    snapshot = (await fixture.deps.memoryManagement.inspect(saved.id))!;
    await fixture.deps.memoryManagement.mutate({ op: "forget", memoryId: saved.id, expectedRevision: snapshot.revision });
    expect(await runtime.consolidateIfNeeded()).not.toBeNull();
    expect(await runtime.consolidateIfNeeded()).toBeNull();
  });

  test("time-only decay becomes due at thirty days and its own receipt settles it", async () => {
    const day = 86_400_000, start = Date.now();
    let now = start;
    const fixture = createInMemoryDeps({ memories: [seedMemory({ id: "m", scope: "user", content: "Aging", importance: 0.6, updatedAt: new Date(start - 29 * day).toISOString() })] });
    const { runtime } = makeRuntime(fixture, () => now);
    await runtime.consolidateIfNeeded();
    now = start + day - 1;
    expect(await runtime.consolidateIfNeeded()).toBeNull();
    now++;
    expect(await runtime.consolidateIfNeeded()).toMatchObject({ decayed: 1 });
    expect(fixture.stores.memories[0]!.importance).toBe(0.51);
    expect(await runtime.consolidateIfNeeded()).toBeNull();
  });

  test("a write after the maintenance commit receipt is not marked as already processed", async () => {
    const fixture = createInMemoryDeps({ memories: [seedMemory({ id: "m", scope: "user", content: "Old", importance: 0.6, updatedAt: "2020-01-01T00:00:00.000Z" })] });
    const original = fixture.deps.memory.applyMemoryChanges;
    fixture.deps.memory.applyMemoryChanges = async (...args) => {
      const receipt = await original(...args);
      await fixture.deps.memoryManagement.mutate({ op: "correct", memoryId: "m", expectedRevision: receipt[0]!.revision, content: "Late user edit" });
      return receipt;
    };
    const { runtime } = makeRuntime(fixture);
    expect(await runtime.consolidateIfNeeded()).toMatchObject({ decayed: 1 });
    expect(await runtime.consolidateIfNeeded()).not.toBeNull();
    expect(await runtime.consolidateIfNeeded()).toBeNull();
    expect(fixture.stores.memories[0]!.content).toBe("Late user edit");
  });

  test("discardThread removes only the selected cached agent state and summary", async () => {
    const { runtime, stores } = makeRuntime();
    const book = { kind: "book" as const, bookId: "book-1" as Id };
    const other = { kind: "book" as const, bookId: "book-2" as Id };
    const first = runtime.thread(book);
    const untouched = runtime.thread(other);
    stores.insights.set("book:book-1", "old hidden context");
    stores.insights.set("book:book-2", "keep this context");

    await runtime.discardThread(book);

    expect(runtime.thread(book)).not.toBe(first);
    expect(runtime.thread(other)).toBe(untouched);
    expect(stores.insights.get("book:book-1")).toBeUndefined();
    expect(stores.insights.get("book:book-2")).toBe("keep this context");
  });
});
