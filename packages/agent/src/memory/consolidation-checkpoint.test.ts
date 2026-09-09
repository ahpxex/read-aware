import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { createInMemoryDeps, seedMemory } from "../testing/fixtures";
import { ConsolidationCheckpoint } from "./consolidation-checkpoint";
import { runConsolidationPass, type RunConsolidationInput } from "./consolidation";

test("failed judgments retry without new writes, while valid no-op judgments settle", async () => {
  const { deps } = createInMemoryDeps({ memories: ["a", "b"].map(id => seedMemory({ id, scope: "user", content: id, updatedAt: new Date().toISOString() })) });
  const gate = new ConsolidationCheckpoint();
  const snapshots = await deps.memory.snapshotMemories();
  const base = { memory: deps.memory, model: {} as RunConsolidationInput["model"], snapshots };
  for (const complete of [async () => { throw Error("offline"); }, async () => fauxAssistantMessage("not json"), async () => fauxAssistantMessage("true"),
    async () => fauxAssistantMessage("{}", { stopReason: "error" }), async () => fauxAssistantMessage("{}", { stopReason: "aborted" }),
    async () => fauxAssistantMessage("{}", { stopReason: "length" }), async () => fauxAssistantMessage("{}", { stopReason: "toolUse" })]) {
    const result = await runConsolidationPass({ ...base, complete });
    expect(result.judgmentSucceeded).toBe(false);
    gate.settle(result.snapshots, result.judgmentSucceeded);
    expect(gate.needed(snapshots, Date.now())).toBe(true);
  }
  const valid = await runConsolidationPass({ ...base, complete: async () => fauxAssistantMessage("{}") });
  gate.settle(valid.snapshots, valid.judgmentSucceeded);
  expect(gate.needed([...snapshots].reverse(), Date.now())).toBe(false);
});

test("failed judgment does not hide committed decay or suppress its next retry", async () => {
  const now = Date.now();
  const { deps } = createInMemoryDeps({ memories: ["a", "b"].map(id => seedMemory({ id, scope: "user", content: id,
    importance: 0.6, updatedAt: new Date(now - 30 * 86_400_000).toISOString() })) });
  const gate = new ConsolidationCheckpoint();
  const base = { memory: deps.memory, model: {} as RunConsolidationInput["model"], now };
  const failed = await runConsolidationPass({ ...base, complete: async () => { throw Error("offline"); } });
  expect(failed.report.decayed).toBe(2);
  expect(failed.snapshots.map(snapshot => snapshot.memory.importance)).toEqual([0.51, 0.51]);
  gate.settle(failed.snapshots, failed.judgmentSucceeded);
  const fresh = await deps.memory.snapshotMemories();
  expect(gate.needed(fresh, now)).toBe(true);
  const retry = await runConsolidationPass({ ...base, snapshots: fresh, complete: async () => fauxAssistantMessage("{}") });
  expect(retry.report.decayed).toBe(0);
  gate.settle(retry.snapshots, retry.judgmentSucceeded);
  expect(gate.needed(await deps.memory.snapshotMemories(), now)).toBe(false);
});
