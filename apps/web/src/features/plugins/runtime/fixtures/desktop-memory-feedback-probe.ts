import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { prepareMemoryDomainProbe, cleanupMemoryDomainProbe, openMemoryDomainDesk } from "./desktop-memory-domain-probe";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { buildMemoryManagementTool } from "../../../../../../../packages/agent/src/tools/memory-management-tool";
import { mutateMemory } from "../../../../domain/memory-management";

let seed: Awaited<ReturnType<typeof prepareMemoryDomainProbe>> | undefined;
const workers: SandboxedPlugin[] = [], owned: PluginDisposable[] = [];
export async function prepareMemoryFeedbackProbe() {
  seed = await prepareMemoryDomainProbe();
  for (const write of [false, true]) {
    const manifest: PluginManifest = { id: `capability-memory-feedback-${write ? "write" : "read"}`, name: "Memory feedback probe", version: "1.0.0", schemaVersion: 1,
      description: JSON.stringify({ memoryId: seed.memoryIds[0] }), permissions: [write ? "memory:write" : "memory:read"], requires: { domains: { memory: "^1.1.0" } } };
    const worker = await startPluginWorker(manifest, "0.5.4", owned, { moduleUrl: new URL("./memory-feedback-probe.ts", import.meta.url).href });
    workers.push(worker); await worker.checkHealth(); worker.promote();
  }
  return seed;
}
export async function memoryFeedbackActor(role: "read" | "write", action: string) {
  if (!seed) throw Error("Prepare isolated probe first");
  const command = getDefaultStore().get(pluginCommandsAtom).find(c => c.pluginId === `capability-memory-feedback-${role}` && c.id === action);
  if (!command) throw Error("Missing probe command"); return JSON.parse((await command.run())!.toast!) as unknown;
}
export async function memoryFeedbackAgent(action: "correct" | "forget" | "setPinned", approve = true, race = false) {
  if (!seed) throw Error("Prepare isolated probe first");
  const deps = buildRuntimeDeps(), memoryId = seed.memoryIds[0]!;
  const snapshot = await deps.memoryManagement.inspect(memoryId); if (!snapshot) throw Error("Missing owned memory");
  const requests: unknown[] = [];
  deps.interactions = { request: async request => {
    requests.push(request);
    if (race) await mutateMemory({ op: "correct", memoryId, expectedRevision: snapshot.revision, content: "Concurrent user correction" }, "user");
    return { optionId: approve ? "approve" : "decline" };
  } };
  const tool = buildMemoryManagementTool({ kind: "global", threadId: "memory-feedback-probe" }, deps);
  try { const result = await tool.execute(crypto.randomUUID(), { action, memoryId, expectedRevision: snapshot.revision,
    ...(action === "correct" ? { content: "Corrected by production Agent tool" } : action === "setPinned" ? { pinned: true } : {}) });
    return { result, requests };
  } catch (error) { return { code: error && typeof error === "object" && "code" in error ? error.code : null, requests }; }
}
export { openMemoryDomainDesk };
export async function cleanupMemoryFeedbackProbe() {
  for (const worker of workers.splice(0)) await worker.terminate();
  for (const item of owned.splice(0).reverse()) item.dispose();
  const clean = await cleanupMemoryDomainProbe(); seed = undefined;
  return { ...clean, feedbackContributions: ["read", "write"].reduce((sum, role) => sum + inspectContributions(`capability-memory-feedback-${role}`).length, 0) };
}
