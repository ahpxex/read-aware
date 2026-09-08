import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { installedPluginsAtom, pluginCommandsAtom, readerModesAtom } from "../../state/plugin-store";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";
import { setPluginEnabled } from "../plugin-host";
import { readingRuntime } from "../../../../domain/reading-runtime";
import type { ReadingModeConfiguration } from "@read-aware/core";
import { buildReaderTools } from "../../../../../../../packages/agent/src/tools/reader-tools";
import { buildRuntimeDeps } from "../../../ai/agent/ports";

const id = "capability-segmentation-probe";
let worker: SandboxedPlugin | undefined;
let disposables: PluginDisposable[] = [];
let restoreSentenceReader = false;
async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw new Error("Use isolated capability-e2e data");
  return path;
}
export async function prepareSegmentationProbe() {
  const dataDir = await isolated();
  if (worker) throw new Error("Clean up the existing probe first");
  restoreSentenceReader = getDefaultStore().get(installedPluginsAtom).some(plugin => plugin.manifest.id === "sentence-reader" && plugin.enabled);
  if (restoreSentenceReader) await setPluginEnabled("sentence-reader", false);
  const manifest: PluginManifest = { id, name: "Segmentation diagnostic", version: "1.0.0", schemaVersion: 1, permissions: ["reader:modes"],
    requires: { contributions: { readerModes: "^1.1.0", commands: "^1.0.0" } } };
  try {
    worker = await startPluginWorker(manifest, "0.5.4", disposables, { moduleUrl: new URL("./segmentation-probe.ts", import.meta.url).href });
    await worker.checkHealth(); worker.promote();
    return { dataDir, restoreSentenceReader, modes: getDefaultStore().get(readerModesAtom).map(mode => mode.key) };
  } catch (error) { await cleanupSegmentationProbe(); throw error; }
}
export async function segmentationBehavior(behavior: "slow" | "reject") {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === behavior);
  if (!command) throw new Error("Probe command unavailable");
  await command.run();
}
export async function segmentationSnapshot() {
  await isolated();
  return readingRuntime.snapshot();
}
let modeAbort: AbortController | undefined;
export async function agentMode(input: ReadingModeConfiguration) {
  await isolated();
  const bookId = readingRuntime.snapshot().bookId;
  if (!bookId) throw new Error("Open the synthetic reading probe book first");
  const abort = new AbortController(); modeAbort = abort;
  const tool = buildReaderTools({ kind: "book", bookId }, buildRuntimeDeps()).find(tool => tool.name === "configure_reading_mode")!;
  try { return await tool.execute("mode-e2e", input, abort.signal); }
  finally { if (modeAbort === abort) modeAbort = undefined; }
}
export async function cancelAgentMode() {
  await isolated(); modeAbort?.abort(new Error("Mode diagnostic cancelled"));
}
export async function pluginMode(active: boolean, unitId: string) {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === "listening-desk" && command.id === "open");
  const result = await command?.run();
  if (!result || result.view?.kind !== "blocks") throw new Error("Listening Desk view unavailable");
  const form = result.view.blocks.find(block => block.kind === "form");
  if (form?.kind !== "form") throw new Error("Listening Desk mode form unavailable");
  return form.onSubmit({ active, unitId });
}
export async function closeProbeBook() {
  await isolated(); await readingRuntime.close(); return readingRuntime.snapshot();
}
export async function cleanupSegmentationProbe() {
  await isolated();
  await worker?.terminate(); worker = undefined;
  for (const disposable of disposables.reverse()) disposable.dispose(); disposables = [];
  if (restoreSentenceReader) { await setPluginEnabled("sentence-reader", true); restoreSentenceReader = false; }
  return { remainingCommands: getDefaultStore().get(pluginCommandsAtom).filter(command => command.pluginId === id).length,
    remainingModes: getDefaultStore().get(readerModesAtom).filter(mode => mode.pluginId === id).length };
}
