import { createAgentRuntime, type AgentRuntime } from "@read-aware/agent";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { prepareMemoryFeedbackProbe, cleanupMemoryFeedbackProbe, memoryFeedbackActor, openMemoryDomainDesk } from "./desktop-memory-feedback-probe";
import { commitDomainEvents, mintEventRows } from "../../src/platform/domain-events";
import { createIpcSyncStore } from "../../src/platform/sync/sync-store";

let seed: Awaited<ReturnType<typeof prepareMemoryFeedbackProbe>> | undefined;
let runtime: AgentRuntime | undefined;
let now = Date.now();
let modelCalls = 0;
export async function prepareMemoryIdleProbe() {
  seed = await prepareMemoryFeedbackProbe(); now = Date.now(); modelCalls = 0;
  const deps = buildRuntimeDeps(), memory = deps.memory;
  runtime = createAgentRuntime({ deps: { ...deps, memory: { ...memory,
    snapshotMemories: async () => (await memory.snapshotMemories()).filter(row => row.memory.id === seed!.memoryIds[0]),
  } }, now: () => now, account: { kind: "api-key", provider: "openai", apiKey: "isolated-fixture" },
    models: { smart: "fixture", fast: "fixture" }, fetch: async () => { modelCalls++; throw Error("Unexpected model request for one-memory fixture"); } });
  return seed;
}
export async function memoryIdleTick() {
  if (!runtime || !seed) throw Error("Prepare isolated memory idle fixture first");
  const report = await runtime.consolidateIfNeeded();
  return { report, modelCalls, now, memory: await buildRuntimeDeps().memoryManagement.inspect(seed.memoryIds[0]!) };
}
export async function memoryIdleExternalWrite(kind: "plugin" | "remote" | "age") {
  if (!seed) throw Error("Prepare isolated memory idle fixture first");
  const memoryId = seed.memoryIds[0]!;
  if (kind === "plugin") {
    await memoryFeedbackActor("write", "inspect"); return memoryFeedbackActor("write", "correct");
  }
  if (kind === "remote") {
    const rows = await mintEventRows([{ type: "memory.revised", origin: "user", payload: { memoryId, content: "Received through native remote apply" } }]);
    return createIpcSyncStore().applyRemote(rows);
  }
  const aged = new Date(Date.now() - 29 * 86_400_000).toISOString();
  await commitDomainEvents({ type: "memory.revised", origin: "user", createdAt: aged, payload: { memoryId, importance: 0.6 } });
  now = Date.now(); return { aged };
}
export function memoryIdleSetTime(value: number) { now = value; return now; }
export { openMemoryDomainDesk };
export async function cleanupMemoryIdleProbe() {
  const result = await cleanupMemoryFeedbackProbe(); runtime = undefined; seed = undefined; return result;
}
