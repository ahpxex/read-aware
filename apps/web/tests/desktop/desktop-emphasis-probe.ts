import { parseProbeToast } from "./probe-toast";
import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest, ReadingEmphasisSnapshot } from "@read-aware/plugin-types";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";
import { prepareRangeProbe, cleanupRangeProbe } from "./desktop-range-probe";

const workers = new Map<string, SandboxedPlugin>(), disposables: PluginDisposable[] = [];
async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Isolated data required");
}
export async function prepareEmphasisProbe() {
  await isolated(); if (workers.size) throw Error("Clean previous probe first");
  const seed = await prepareRangeProbe();
  for (const access of ["none", "read", "write"] as const) await addEmphasisProbe(access, access);
  return seed;
}
export async function addEmphasisProbe(id: string, access: "none" | "read" | "write", foreign?: ReadingEmphasisSnapshot) {
  await isolated(); if (workers.has(id)) throw Error("Duplicate probe");
  const manifest: PluginManifest = { id: `capability-emphasis-${id}`, name: "Emphasis probe", version: "1.0.0", schemaVersion: 1,
    description: foreign ? JSON.stringify(foreign) : undefined,
    permissions: access === "none" ? [] : [`reading:${access}`, "library:read"],
    requires: access === "none" ? {} : { domains: { reading: "^2.11.0", library: "^1.7.0" } } };
  const worker = await startPluginWorker(manifest, "0.5.4", disposables, { moduleUrl: new URL("./emphasis-probe.ts", import.meta.url).href });
  workers.set(id, worker); await worker.checkHealth(); worker.promote();
}
export async function callEmphasisProbe(id: string, action: string) {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(c => c.pluginId === `capability-emphasis-${id}` && c.id === action);
  if (!command) throw Error("Missing probe command");
  return parseProbeToast((await command.run())!.toast!);
}
export async function stopEmphasisProbe(id: string) { await isolated(); await workers.get(id)?.terminate(); }
export async function cleanupEmphasisProbe() {
  await isolated();
  for (const worker of workers.values()) await worker.terminate();
  for (const item of disposables.splice(0).reverse()) item.dispose();
  const contributions = [...workers.keys()].map(id => [id, inspectContributions(`capability-emphasis-${id}`).length]); workers.clear();
  return { contributions, range: await cleanupRangeProbe() };
}
