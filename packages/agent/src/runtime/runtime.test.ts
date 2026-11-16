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
    // Unit tests never reach a provider: a model call fails at once instead of depending on
    // whether this machine can reach api.openai.com (without it the call hangs to the timeout).
    fetch: async () => {
      throw new Error("Provider network is unavailable in unit tests");
    },
  });
  return { runtime, stores, memoryLists: () => memoryLists };
}

describe("AgentRuntime maintenance", () => {
  test("public graph execution uses the host-bound text port under the existing cancellation policy", async () => {
    const fixture = createInMemoryDeps({
      books: [{ id: "b", title: "Book", narrativity: "narrative", status: "finished" }],
    });
    let defaultReads = 0,
      boundReads = 0;
    fixture.deps.bookText.getToc = async () => {
      defaultReads++;
      return [];
    };
    const { runtime } = makeRuntime(fixture);
    const input = {
      bookId: "b",
      rebuild: false,
      maxChapters: 1,
      signal: new AbortController().signal,
      resolveBoundary: async () => 1,
      onStarted() {},
      onPlan() {},
      onChapterAttempted() {},
      onChapterCommitted() {},
      onReport() {},
      bookText: {
        ...fixture.deps.bookText,
        getToc: async () => {
          boundReads++;
          return [];
        },
      },
    };
    expect(await runtime.runBookGraphTask(input)).toMatchObject({ status: "unavailable", reason: "no-toc" });
    expect(boundReads).toBeGreaterThan(0);
    expect(defaultReads).toBe(0);
    const before = boundReads;
    await expect(runtime.runBookGraphTask({ ...input, signal: AbortSignal.abort() })).rejects.toThrow();
    expect(boundReads).toBe(before);
  });
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
    const saved = await fixture.deps.memory.saveMemory({
      scope: "user",
      kind: "fact",
      content: "External",
      origin: "plugin",
      sourceThreadKey: "global",
    });
    expect(await runtime.consolidateIfNeeded()).not.toBeNull();
    let snapshot = (await fixture.deps.memoryManagement.inspect(saved.id))!;
    await fixture.deps.memoryManagement.mutate({
      op: "correct",
      memoryId: saved.id,
      expectedRevision: snapshot.revision,
      content: "User correction",
    });
    expect(await runtime.consolidateIfNeeded()).not.toBeNull();
    snapshot = (await fixture.deps.memoryManagement.inspect(saved.id))!;
    await fixture.deps.memoryManagement.mutate({
      op: "forget",
      memoryId: saved.id,
      expectedRevision: snapshot.revision,
    });
    expect(await runtime.consolidateIfNeeded()).not.toBeNull();
    expect(await runtime.consolidateIfNeeded()).toBeNull();
  });

  test("time-only decay becomes due at thirty days and its own receipt settles it", async () => {
    const day = 86_400_000,
      start = Date.now();
    let now = start;
    const fixture = createInMemoryDeps({
      memories: [
        seedMemory({
          id: "m",
          scope: "user",
          content: "Aging",
          importance: 0.6,
          updatedAt: new Date(start - 29 * day).toISOString(),
        }),
      ],
    });
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
    const fixture = createInMemoryDeps({
      memories: [
        seedMemory({ id: "m", scope: "user", content: "Old", importance: 0.6, updatedAt: "2020-01-01T00:00:00.000Z" }),
      ],
    });
    const original = fixture.deps.memory.applyMemoryChanges;
    fixture.deps.memory.applyMemoryChanges = async (...args) => {
      const receipt = await original(...args);
      await fixture.deps.memoryManagement.mutate({
        op: "correct",
        memoryId: "m",
        expectedRevision: receipt[0]!.revision,
        content: "Late user edit",
      });
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

  test("host-origin discard awaits its causal insight writer instead of using the default Agent writer", async () => {
    const fixture = createInMemoryDeps(),
      { runtime } = makeRuntime(fixture);
    fixture.deps.conversations.clearInsights = async () => {
      throw Error("wrong actor writer");
    };
    const gate = Promise.withResolvers<void>(),
      writes: string[] = [];
    let settled = false;
    const pending = runtime
      .discardThread({ kind: "book", bookId: "book-1" as Id }, async (key) => {
        writes.push(key);
        await gate.promise;
      })
      .then(() => {
        settled = true;
      });
    await Promise.resolve();
    expect(writes).toEqual(["book:book-1"]);
    expect(settled).toBe(false);
    gate.resolve();
    await pending;
    expect(settled).toBe(true);
  });
});

describe("AgentRuntime thread titles", () => {
  /** The runtime with its threads' turns replaced by `chunks` (no provider), and the title calls it makes. */
  function withTurns(chunks: () => AsyncGenerator<never>) {
    const { runtime } = makeRuntime();
    const titled: unknown[] = [];
    runtime.thread = (() => ({ sendTurn: chunks })) as unknown as typeof runtime.thread;
    runtime.titleThreads = async (query) => {
      titled.push(query);
      return { titled: 0, halted: false };
    };
    return { runtime, titled };
  }

  test("a finished global turn asks for its thread's title; a book turn does not", async () => {
    const { runtime, titled } = withTurns(async function* () {});
    for await (const _ of runtime.sendTurn({ kind: "global", threadId: "thread-1" }, { text: "hi" })) {
      // drain
    }
    for await (const _ of runtime.sendTurn({ kind: "book", bookId: "b1" as Id }, { text: "hi" })) {
      // drain
    }
    expect(titled).toEqual([{ limit: 1, threadKey: "global:thread-1" }]);
  });

  test("a turn that fails or is abandoned asks for no title", async () => {
    // A turn that starts streaming and then fails.
    const failing = withTurns(async function* () {
      yield undefined as never;
      throw new Error("provider failed");
    });
    await expect(
      (async () => {
        for await (const _ of failing.runtime.sendTurn({ kind: "global", threadId: "thread-1" }, { text: "hi" })) {
          // drain
        }
      })(),
    ).rejects.toThrow("provider failed");
    expect(failing.titled).toEqual([]);

    const abandoned = withTurns(async function* () {
      yield undefined as never;
      yield undefined as never;
    });
    const turn = abandoned.runtime.sendTurn({ kind: "global", threadId: "thread-1" }, { text: "hi" });
    await turn.next();
    await turn.return(undefined);
    expect(abandoned.titled).toEqual([]);
  });
});
