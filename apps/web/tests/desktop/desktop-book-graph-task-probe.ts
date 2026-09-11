import { parseProbeToast } from "./probe-toast";
import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { prepareMemoryDomainProbe, cleanupMemoryDomainProbe } from "./desktop-memory-domain-probe";
import { AI_CONFIG_KEY, encodeAIConfig } from "../../src/features/ai/lib/ai-config";
import { AI_PREFERENCES_KEY, getAIPreferences } from "../../src/features/settings/lib/ai-preferences";
import { localKV, flushLocalKV } from "../../src/platform/local-store";
import { getSecret, setSecretAsync } from "../../src/platform/secret-store";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import { createBookMemoryPort } from "../../src/features/ai/agent/ports/book-memory-port";
import { buildBookGraphTaskTool } from "../../../../packages/agent/src/tools/book-graph-task-tool";
import { invoke } from "../../src/platform/ipc";

let seed: Awaited<ReturnType<typeof prepareMemoryDomainProbe>> | undefined;
let restore: { config: string | null; preferences: string | null; customKey: string } | undefined;
const workers = new Map<string, SandboxedPlugin>(), owned: PluginDisposable[] = [], agentTasks: string[] = [];
const BACKUP_KEY = "capability-e2e.graph-task-configuration";
async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Isolated data required");
}
export async function prepareGraphTaskProbeConfiguration() {
  await isolated(); if (restore || seed) throw Error("Probe already prepared");
  if (await invoke<string | null>("secret_get", { key: BACKUP_KEY })) throw Error("Recover the prior probe configuration before preparing again");
  await flushLocalKV();
  restore = { config: localKV.getItem(AI_CONFIG_KEY), preferences: localKV.getItem(AI_PREFERENCES_KEY), customKey: getSecret("ai-api-key.custom") };
  // Write-ahead recovery stays encrypted and outside credential sync/hydration prefixes.
  await invoke("secret_set", { key: BACKUP_KEY, value: JSON.stringify(restore) });
  await setSecretAsync("ai-api-key.custom", "loopback-test-only");
  localKV.setItem(AI_CONFIG_KEY, encodeAIConfig({ provider: "custom", apiKey: "loopback-test-only", model: "graph-task", customApi: "openai-completions", customBaseUrl: "http://127.0.0.1:19844/v1", thinkingLevel: "off" }));
  localKV.setItem(AI_PREFERENCES_KEY, JSON.stringify({ ...getAIPreferences(), buildMemory: false, localOnly: false }));
  await flushLocalKV(); return { recoveryAvailable: true };
}
export async function recoverGraphTaskProbeConfiguration() {
  await isolated(); if (seed || workers.size) throw Error("Drain and clean the active probe first");
  const raw = await invoke<string | null>("secret_get", { key: BACKUP_KEY });
  if (!raw) { restore = undefined; return { restored: false }; }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid encrypted probe recovery data");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 3 || !(data.config === null || typeof data.config === "string")
    || !(data.preferences === null || typeof data.preferences === "string") || typeof data.customKey !== "string") throw Error("Invalid encrypted probe recovery data");
  await setSecretAsync("ai-api-key.custom", data.customKey);
  for (const [key, saved] of [[AI_CONFIG_KEY, data.config], [AI_PREFERENCES_KEY, data.preferences]] as const) {
    if (saved === null) localKV.removeItem(key); else localKV.setItem(key, saved);
  }
  await flushLocalKV();
  if (localKV.getItem(AI_CONFIG_KEY) !== data.config || localKV.getItem(AI_PREFERENCES_KEY) !== data.preferences || getSecret("ai-api-key.custom") !== data.customKey)
    throw Error("Probe configuration did not restore");
  await invoke("secret_delete", { key: BACKUP_KEY }); restore = undefined;
  return { restored: true };
}
export async function prepareBookGraphTaskProbe() {
  await prepareGraphTaskProbeConfiguration(); seed = await prepareMemoryDomainProbe();
  localKV.setItem(AI_PREFERENCES_KEY, JSON.stringify({ ...getAIPreferences(), buildMemory: true })); await flushLocalKV();
  for (const role of ["read", "write", "llm"] as const) {
    const declaration: PluginManifest = { id: `capability-graph-task-${role}`, name: "Graph task probe", version: "1.0.0", schemaVersion: 1,
      description: JSON.stringify({ bookId: seed.bookId }), permissions: role === "read" ? ["memory:read"] : role === "write" ? ["memory:write"] : ["memory:write", "service:llm"],
      requires: { domains: { memory: "^1.5.0" } } };
    const worker = await startPluginWorker(declaration, "0.5.4", owned, { moduleUrl: new URL("./book-graph-task-probe.ts", import.meta.url).href });
    workers.set(role, worker); await worker.checkHealth(); worker.promote();
  }
  return seed;
}
export async function graphTaskActor(role: "read" | "write" | "llm", action: string) {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === `capability-graph-task-${role}` && item.id === action);
  if (!command) throw Error("Missing task command"); return parseProbeToast((await command.run())!.toast!);
}
export async function graphTaskAgent(action: string, approved = true, taskId?: string) {
  await isolated(); if (!seed) throw Error("Prepare fixture");
  const deps = buildRuntimeDeps(); let approvals = 0;
  deps.interactions.request = async () => { approvals++; return { optionId: approved ? "approve" : "decline" }; };
  const result = await buildBookGraphTaskTool({ kind: "book", bookId: seed.bookId }, deps).execute("graph-task-e2e", { action, ...(taskId ? { taskId } : {}) });
  const value = result.content[0]?.type === "text" ? JSON.parse(result.content[0].text) : null;
  if (value?.taskId) agentTasks.push(value.taskId);
  return { approvals, value };
}
export async function retireGraphTaskActor() { await isolated(); await workers.get("llm")?.terminate(); workers.delete("llm"); }
export async function cleanupBookGraphTaskProbe() {
  await isolated();
  for (const worker of workers.values()) await worker.terminate(); workers.clear();
  for (const item of owned.splice(0).reverse()) item.dispose();
  if (seed) {
    const tasks = buildRuntimeDeps().bookGraphTasks;
    for (const task of await tasks.list(seed.bookId)) await tasks.cancel(seed.bookId, task.taskId);
    for (let i = 0; i < 100; i++) {
      const active = (await tasks.list(seed.bookId)).some(task => ["queued", "running", "cancelling"].includes(task.status));
      if (!active) break;
      if (i === 99) throw Error("Agent task receipts not drained");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  if (seed) await createBookMemoryPort().runExclusive(seed.bookId, async () => {});
  const clean = await cleanupMemoryDomainProbe(); seed = undefined; agentTasks.length = 0;
  return { ...clean, configuration: await recoverGraphTaskProbeConfiguration() };
}
