import { describe, expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import { createInMemoryDeps, seedMemory } from "../testing/fixtures";
import { buildMemoryTools } from "../tools/memory-tools";
import { applyOnboarding } from "../onboarding";
import { createAgentRuntime } from "../runtime/runtime";
import { runMemoryBuild } from "./build-policy";
import { memoryPolicyState } from "../testing/memory-policy";

describe("memory build policy", () => {
  test("blocks explicit remember and onboarding but keeps existing memory readable", async () => {
    const state = memoryPolicyState();
    const { deps, stores } = createInMemoryDeps();
    deps.memoryPolicy = state.policy;
    const tools = buildMemoryTools({ kind: "global", threadId: "policy-test" }, deps);
    const remember = tools.find(tool => tool.name === "remember")!;
    const params = { content: "A retained preference", scope: "user", kind: "preference" };
    await remember.execute("test", params);
    state.set(false);
    await expect(remember.execute("test", params)).rejects.toMatchObject({ code: "ai/memory-disabled", retryable: false });
    await expect(applyOnboarding(deps, { goals: "do not save" })).rejects.toMatchObject({ code: "ai/memory-disabled" });
    const read = await tools.find(tool => tool.name === "search_memory")!.execute("test", {});
    expect(JSON.stringify(read)).toContain("A retained preference");
    expect(stores.memories).toHaveLength(1);
    expect(stores.profile.summary).toBeUndefined();
    expect(state.count()).toBe(0);
  });

  test("revokes all derived write destinations and late plugin candidate results", async () => {
    const state = memoryPolicyState();
    const { deps, stores } = createInMemoryDeps();
    deps.memoryPolicy = state.policy;
    let resolve!: (value: []) => void;
    deps.extraMemoryCandidates = () => new Promise(done => { resolve = done; });
    let guarded = deps;
    const pending = runMemoryBuild(deps, operation => {
      guarded = operation.protect(deps);
      return guarded.extraMemoryCandidates!({ scope: { kind: "global", threadId: "policy-test" }, userText: "x", assistantText: "y" });
    });
    state.set(false);
    await expect(pending).rejects.toMatchObject({ code: "ai/memory-disabled" });
    state.set(true);
    resolve([]);
    const writes = [
      () => guarded.memory.saveMemory({ scope: "user", kind: "fact", content: "late", origin: "plugin", sourceThreadKey: "global" }),
      () => guarded.memory.reinforceMemory({ memory: seedMemory({ id: "any", scope: "user", content: "test" }), revision: `mem1:${"0".repeat(64)}` }),
      () => guarded.memory.applyMemoryChanges([], []),
      () => guarded.profile.putProfileSummary("late"),
      () => guarded.conversations.putInsights("global", "late"),
      () => guarded.bookMemory.saveDigest("book" as Id, { chapterIndex: 0, summary: "late", characters: [], relations: [], digestVersion: 1 }, `bdg1:${"a".repeat(64)}`),
      () => guarded.library.classifyBookIfUnclassified("book" as Id, "narrative"),
      () => guarded.extraMemoryCandidates!({ scope: { kind: "global", threadId: "policy-test" }, userText: "late", assistantText: "late" }),
    ];
    for (const write of writes) await expect(write()).rejects.toMatchObject({ code: "ai/memory-disabled" });
    expect(stores.memories).toHaveLength(0); expect(stores.insights.size).toBe(0);
    expect(stores.chapterDigests.size).toBe(0); expect(state.count()).toBe(0);
    await runMemoryBuild(deps, operation => operation.protect(deps).conversations.putInsights("global", "new"));
    expect(stores.insights.get("global")).toBe("new");
  });

  test("cancels a hung model call and refuses new model work for that operation", async () => {
    const state = memoryPolicyState();
    let signal: AbortSignal | undefined;
    let calls = 0;
    const pending = runMemoryBuild({ memoryPolicy: state.policy }, async operation => {
      const complete = operation.complete((_m, _c, options) => {
        calls++; signal = options?.signal; return new Promise(() => {});
      });
      return complete({} as never, { messages: [] });
    });
    state.set(false);
    await expect(pending).rejects.toMatchObject({ code: "ai/memory-disabled" });
    expect(signal?.aborted).toBe(true); expect(calls).toBe(1); expect(state.count()).toBe(0);
  });

  test("idle maintenance skips while disabled, explicit jobs fail, cached runtime resumes later", async () => {
    const state = memoryPolicyState(); state.set(false);
    const { deps } = createInMemoryDeps(); deps.memoryPolicy = state.policy;
    let reads = 0;
    deps.memory.snapshotMemories = async () => { reads++; return []; };
    const runtime = createAgentRuntime({ deps, account: { kind: "api-key", provider: "openai", apiKey: "test" }, models: { smart: "test", fast: "test" } });
    expect(await runtime.consolidateIfNeeded()).toBeNull();
    await expect(runtime.consolidate()).rejects.toMatchObject({ code: "ai/memory-disabled" });
    await expect(runtime.digestBook("book" as Id)).rejects.toMatchObject({ code: "ai/memory-disabled" });
    await expect(runtime.digestBookCatchUp("book" as Id)).rejects.toMatchObject({ code: "ai/memory-disabled" });
    expect(reads).toBe(0);
    state.set(true);
    expect(await runtime.consolidateIfNeeded()).not.toBeNull();
    expect(reads).toBe(1); expect(state.count()).toBe(0);
  });

  test("a cancelled consolidation cannot mark a dirty revision clean after a late read", async () => {
    const state = memoryPolicyState();
    const { deps } = createInMemoryDeps(); deps.memoryPolicy = state.policy;
    let release!: () => void;
    let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    let reads = 0;
    deps.memory.snapshotMemories = async () => {
      reads++;
      if (reads === 1) { started(); await new Promise<void>(resolve => { release = resolve; }); }
      return [];
    };
    const runtime = createAgentRuntime({ deps, account: { kind: "api-key", provider: "openai", apiKey: "test" }, models: { smart: "test", fast: "test" } });
    const cancelled = runtime.consolidateIfNeeded();
    await reading;
    state.set(false);
    await expect(cancelled).rejects.toMatchObject({ code: "ai/memory-disabled" });
    state.set(true); release();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await runtime.consolidateIfNeeded()).not.toBeNull();
    expect(reads).toBe(2);
    expect(state.count()).toBe(0);
  });
});
