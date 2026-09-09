import { prepareMemoryFeedbackProbe, cleanupMemoryFeedbackProbe, memoryFeedbackActor, openMemoryDomainDesk } from "./desktop-memory-feedback-probe";
import { createMemoryPort } from "../../../ai/agent/ports/memory-port";
import { runConsolidation, type RunConsolidationInput } from "../../../../../../../packages/agent/src/memory/consolidation";

let seed: Awaited<ReturnType<typeof prepareMemoryFeedbackProbe>> | undefined;
export async function prepareMemoryMaintenanceProbe() {
  seed = await prepareMemoryFeedbackProbe();
  return seed;
}
async function snapshots() {
  if (!seed) throw Error("Prepare isolated memory fixture first");
  return (await createMemoryPort().snapshotMemories()).filter(item => seed!.memoryIds.slice(0, 2).includes(item.memory.id));
}
export async function maintenanceRace() {
  if (!seed) throw Error("Prepare isolated memory fixture first");
  const memory = createMemoryPort(), before = await snapshots();
  let result: unknown;
  try {
    result = await runConsolidation({ memory: { ...memory, snapshotMemories: async () => before },
      model: { id: "fixture", provider: "fixture", api: "fixture" } as unknown as RunConsolidationInput["model"],
      complete: async () => {
        await memoryFeedbackActor("write", "inspect");
        await memoryFeedbackActor("write", "correct");
        return { role: "assistant", content: [{ type: "text", text: JSON.stringify({ merges: [{ keep: seed!.memoryIds[0], drop: seed!.memoryIds[1] }] }) }],
          api: "openai-completions", provider: "fixture", model: "fixture", stopReason: "stop", timestamp: Date.now(),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      } });
  } catch (error) { result = { code: error && typeof error === "object" && "code" in error ? error.code : null }; }
  let reinforcement: unknown;
  try { await memory.reinforceMemory(before.find(row => row.memory.id === seed!.memoryIds[0])!); reinforcement = "committed"; }
  catch (error) { reinforcement = { code: error && typeof error === "object" && "code" in error ? error.code : null }; }
  return { result, reinforcement, before, after: await snapshots() };
}
export async function maintenanceMerge() {
  if (!seed) throw Error("Prepare isolated memory fixture first");
  try {
    await createMemoryPort().applyMemoryChanges([{ type: "supersede", id: seed.memoryIds[1]!, byId: seed.memoryIds[0]! }], await snapshots());
    return { committed: true, snapshots: await snapshots() };
  } catch (error) { return { code: error && typeof error === "object" && "code" in error ? error.code : null, snapshots: await snapshots() }; }
}
export { openMemoryDomainDesk };
export async function cleanupMemoryMaintenanceProbe() {
  const result = await cleanupMemoryFeedbackProbe(); seed = undefined; return result;
}
