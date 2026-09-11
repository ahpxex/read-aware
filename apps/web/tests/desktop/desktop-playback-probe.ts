import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { installedPluginsAtom, pluginCommandsAtom, voiceProvidersAtom } from "../../src/features/plugins/state/plugin-store";
import { startPluginWorker, type SandboxedPlugin } from "../../src/features/plugins/runtime/plugin-worker-host";
import { setPluginEnabled } from "../../src/features/plugins/runtime/plugin-host";
import { readingRuntime } from "../../src/domain/reading-runtime";
import { buildReaderTools } from "../../../../packages/agent/src/tools/reader-tools";
import { buildRuntimeDeps } from "../../src/features/ai/agent/ports";

const id = "capability-playback-probe";
let worker: SandboxedPlugin | undefined;
let disposables: PluginDisposable[] = [];
let restoreTts = false;
async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw new Error("Use isolated capability-e2e data");
  return path;
}

export async function preparePlaybackProbe() {
  const dataDir = await isolated();
  if (worker) throw new Error("Clean up the previous playback probe first");
  restoreTts = getDefaultStore().get(installedPluginsAtom).some(plugin => plugin.manifest.id === "tts" && plugin.enabled);
  if (restoreTts) await setPluginEnabled("tts", false);
  const manifest: PluginManifest = { id, name: "Playback diagnostic", version: "1.0.0", schemaVersion: 1, permissions: [],
    requires: { contributions: { voiceProviders: "^1.0.0", commands: "^1.0.0" } } };
  try {
    worker = await startPluginWorker(manifest, "0.5.4", disposables, { moduleUrl: new URL("./playback-probe.ts", import.meta.url).href });
    await worker.checkHealth(); worker.promote();
    return { dataDir, restoreTts, commands: getDefaultStore().get(pluginCommandsAtom).map(command => `${command.pluginId}:${command.id}`),
      voices: getDefaultStore().get(voiceProvidersAtom).map(provider => ({ key: provider.key, voices: provider.voices })) };
  } catch (error) { await cleanupPlaybackProbe(); throw error; }
}

export async function playbackCommand(pluginId: string, commandId: string) {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === pluginId && command.id === commandId);
  if (!command) throw new Error("Playback command not registered");
  await command.run();
  return readingRuntime.snapshot();
}

export async function agentPlayback(action: "start" | "stop") {
  await isolated();
  const bookId = readingRuntime.snapshot().bookId;
  if (!bookId) throw new Error("Open the synthetic reading probe book first");
  const tools = buildReaderTools({ kind: "book", bookId }, buildRuntimeDeps());
  return tools.find(tool => tool.name === "control_read_aloud")!.execute("playback-e2e", { action });
}

export async function toggleListeningDesk(enabled: boolean) {
  await isolated();
  await setPluginEnabled("listening-desk", enabled);
  return { playback: readingRuntime.snapshot().playback,
    commands: getDefaultStore().get(pluginCommandsAtom).filter(command => command.pluginId === "listening-desk").map(command => command.id) };
}

export async function cleanupPlaybackProbe() {
  await isolated();
  await worker?.terminate(); worker = undefined;
  for (const disposable of disposables.reverse()) disposable.dispose(); disposables = [];
  if (restoreTts) { await setPluginEnabled("tts", true); restoreTts = false; }
  return { remainingCommands: getDefaultStore().get(pluginCommandsAtom).filter(command => command.pluginId === id).length,
    remainingVoices: getDefaultStore().get(voiceProvidersAtom).filter(provider => provider.pluginId === id).length };
}
