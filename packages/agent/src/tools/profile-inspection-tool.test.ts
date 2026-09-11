import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { createInMemoryDeps, seedMemory } from "../testing/fixtures";
import { memoryPolicyState } from "../testing/memory-policy";
import { buildMemoryTools } from "./memory-tools";
import type { ThreadScope } from "../thread-scope";

test("both scopes inspect derived provenance without writes or inference even with automatic memory disabled", async () => {
  for (const scope of [{ kind: "global", threadId: "t" }, { kind: "book", bookId: "b" }] as ThreadScope[]) {
    const { deps } = createInMemoryDeps({ profile: "Curated", memories: [seedMemory({ id: "source", scope: "user", content: "Reader evidence", pinned: true })] });
    const observed = await deps.identityConsolidation.snapshot();
    await deps.identityConsolidation.commit({ expectedRevision: observed.revision, entitiesRevision: observed.entitiesRevision,
      summary: "Inferred", sources: observed.sources.map(source => ({ memoryId: source.memory.id, revision: source.revision })), decisions: [], complete: false });
    const policy = memoryPolicyState(); policy.set(false); deps.memoryPolicy = policy.policy;
    const tool = buildMemoryTools(scope, deps).find(tool => tool.name === "inspect_user_profile")!;
    const controller = new AbortController(), read = deps.profile.inspectProfileContext; let calls = 0;
    deps.profile.inspectProfileContext = async (input, signal) => { expect(signal).toBe(controller.signal); calls++; return read(input, signal); };
    const result = await tool.execute("inspect", {}, controller.signal);
    expect(result.content[0]?.type).toBe("text");
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ text: "Inferred", derivedStatus: "current" });
    expect(await deps.profile.getProfileSummary()).toBe("Curated");
    await expect(tool.execute("injection", { write: true })).rejects.toMatchObject({ code: "memory/invalid-query" });
    expect(calls).toBe(1);
    controller.abort(); await expect(tool.execute("cancelled", {}, controller.signal)).rejects.toBeDefined();
    deps.profile.inspectProfileContext = async () => { throw new AppError("db/locked", "private"); };
    await expect(tool.execute("error", {})).rejects.toMatchObject({ code: "db/locked" });
  }
});
