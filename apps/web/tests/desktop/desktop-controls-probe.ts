import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { readingRuntime } from "../../src/domain/reading-runtime";
import { runPluginContribution } from "../../src/features/plugins/lib/run-result";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";
import { buildReaderTools } from "../../../../packages/agent/src/tools/reader-tools";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";
import manifest from "../../../../plugins/listening-desk/manifest.json";

const id = "capability-controls-desk";
const owned: PluginDisposable[] = [];
let worker: SandboxedPlugin | undefined;
async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Use isolated capability-e2e data");
  return path;
}
export async function prepareControlsProbe() {
  const dataDir = await isolated();
  if (worker) throw Error("Clean up the previous controls probe first");
  try {
    worker = await startPluginWorker({ ...manifest, id } as PluginManifest, "0.5.4", owned,
      { moduleUrl: new URL("../../../../plugins/listening-desk/dist/main.js", import.meta.url).href });
    await worker.checkHealth(); worker.promote();
    return { dataDir, version: manifest.version, contributions: inspectContributions(id) };
  } catch (error) { await cleanupControlsProbe(); throw error; }
}
export async function openControlsDesk() {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === "open");
  if (!command) throw Error("Listening Desk unavailable");
  await runPluginContribution(id, manifest.name, () => command.run(), { presentation: "dialog", owner: command.run });
}
export async function agentControls(visible: boolean, bookId = readingRuntime.snapshot().bookId) {
  await isolated();
  if (!bookId) throw Error("Open the synthetic reading probe book first");
  const tool = buildReaderTools({ kind: "book", bookId }, buildRuntimeDeps()).find(tool => tool.name === "set_reader_controls")!;
  return tool.execute("controls-e2e", { visible });
}
export async function inspectControls() {
  await isolated();
  const { visibleText: _text, ...snapshot } = readingRuntime.snapshot();
  return snapshot;
}
export async function cleanupControlsProbe() {
  await isolated();
  await worker?.terminate(); worker = undefined;
  for (const disposable of owned.splice(0).reverse()) disposable.dispose();
  return { contributions: inspectContributions(id).length };
}
