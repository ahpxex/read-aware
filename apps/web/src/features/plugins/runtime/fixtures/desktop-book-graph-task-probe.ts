import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { prepareMemoryDomainProbe, cleanupMemoryDomainProbe } from "./desktop-memory-domain-probe";
import { AI_CONFIG_KEY, encodeAIConfig } from "../../../ai/lib/ai-config";
import { AI_PREFERENCES_KEY, getAIPreferences } from "../../../settings/lib/ai-preferences";
import { localKV, flushLocalKV } from "../../../../platform/local-store";
import { getSecret, setSecretAsync } from "../../../../platform/secret-store";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { createBookMemoryPort } from "../../../ai/agent/ports/book-memory-port";
import { buildBookGraphTaskTool } from "../../../../../../../packages/agent/src/tools/book-graph-task-tool";

let seed: Awaited<ReturnType<typeof prepareMemoryDomainProbe>> | undefined;
let restore: { config: string | null; preferences: string | null; customKey: string } | undefined;
const workers = new Map<string, SandboxedPlugin>(), owned: PluginDisposable[] = [], agentTasks: string[] = [];
async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Isolated data required");
}
export async function prepareBookGraphTaskProbe() {
  await isolated(); if (restore || seed) throw Error("Probe already prepared");
  restore = { config: localKV.getItem(AI_CONFIG_KEY), preferences: localKV.getItem(AI_PREFERENCES_KEY), customKey: getSecret("ai-api-key.custom") };
  await setSecretAsync("ai-api-key.custom", "loopback-test-only");
  localKV.setItem(AI_CONFIG_KEY, encodeAIConfig({ provider: "custom", apiKey: "loopback-test-only", model: "graph-task", customApi: "openai-completions", customBaseUrl: "http://127.0.0.1:19844/v1", thinkingLevel: "off" }));
  localKV.setItem(AI_PREFERENCES_KEY, JSON.stringify({ ...getAIPreferences(), buildMemory: true, localOnly: false }));
  await flushLocalKV(); seed = await prepareMemoryDomainProbe();
  for (const role of ["read", "write", "llm"] as const) {
    const declaration: PluginManifest = { id: `capability-graph-task-${role}`, name: "Graph task probe", version: "1.0.0", schemaVersion: 1,
      description: JSON.stringify({ bookId: seed.bookId }), permissions: role === "read" ? ["memory:read"] : role === "write" ? ["memory:write"] : ["memory:write", "service:llm"],
      requires: { domains: { memory: "^1.4.0" } } };
    const worker = await startPluginWorker(declaration, "0.5.4", owned, { moduleUrl: new URL("./book-graph-task-probe.ts", import.meta.url).href });
    workers.set(role, worker); await worker.checkHealth(); worker.promote();
  }
  return seed;
}
export async function graphTaskActor(role: "read" | "write" | "llm", action: string) {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === `capability-graph-task-${role}` && item.id === action);
  if (!command) throw Error("Missing task command"); return JSON.parse((await command.run())!.toast!);
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
    for (const id of agentTasks) await tasks.cancel(seed.bookId, id);
    for (let i = 0; i < 100; i++) {
      const active = (await tasks.list(seed.bookId)).some(task => ["queued", "running", "cancelling"].includes(task.status));
      if (!active) break;
      if (i === 99) throw Error("Agent task receipts not drained");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  if (seed) await createBookMemoryPort().runExclusive(seed.bookId, async () => {});
  const clean = await cleanupMemoryDomainProbe(); seed = undefined; agentTasks.length = 0;
  if (restore) {
    await setSecretAsync("ai-api-key.custom", restore.customKey);
    for (const [key, value] of [[AI_CONFIG_KEY, restore.config], [AI_PREFERENCES_KEY, restore.preferences]]) {
      if (value === null) localKV.removeItem(key!); else localKV.setItem(key!, value!);
    }
    await flushLocalKV(); restore = undefined;
  }
  return clean;
}
