import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { buildEnvironmentTools } from "../../../../../../../packages/agent/src/tools/environment-tools";
import listeningManifest from "../../../../../../../plugins/listening-desk/manifest.json";
import { runPluginContribution } from "../../lib/run-result";

const id = "capability-environment-probe";
let worker: SandboxedPlugin | undefined;
let disposables: PluginDisposable[] = [];
let preview: SandboxedPlugin | undefined;
let previewOwned: PluginDisposable[] = [];
async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Use isolated capability-e2e data");
  return path;
}
export async function prepareEnvironmentProbe() {
  const path = await isolated();
  if (worker) throw Error("Probe already active");
  try {
    worker = await startPluginWorker({ id, name: "Environment diagnostic", version: "1.0.0", schemaVersion: 1, permissions: [],
      requires: { services: { session: "^2.0.0" }, contributions: { commands: "^1.0.0" } } }, "0.5.4", disposables,
      { moduleUrl: new URL("./environment-probe.ts", import.meta.url).href });
    await worker.checkHealth(); worker.promote();
    return { path };
  } catch (error) { await cleanupEnvironmentProbe(); throw error; }
}
export async function pluginEnvironment(action: "read" | "dispose" = "read") {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === action);
  if (!command) throw Error("Environment command unavailable");
  const result = await command.run();
  if (!result?.toast) throw Error("Environment receipt missing");
  return JSON.parse(result.toast) as unknown;
}
export async function agentEnvironment() {
  await isolated();
  return buildEnvironmentTools(buildRuntimeDeps())[0]!.execute("environment-e2e", {});
}
/** Built practical plugin in an isolated identity, without replacing the user's installation. */
export async function listeningEnvironmentPreview(present = false) {
  await isolated();
  if (preview) throw Error("Listening preview already active");
  const pluginId = "capability-listening-environment";
  try {
    preview = await startPluginWorker({ ...listeningManifest, id: pluginId } as PluginManifest, "0.5.4", previewOwned,
      { moduleUrl: new URL("../../../../../../../plugins/listening-desk/dist/main.js", import.meta.url).href });
    await preview.checkHealth(); preview.promote();
    const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === pluginId && command.id === "open");
    if (!command) throw Error("Listening Desk command unavailable");
    if (present) {
      await runPluginContribution(pluginId, listeningManifest.name, command.run);
      return { presented: true };
    }
    return await command.run();
  } catch (error) { await cleanupListeningPreview(); throw error; }
  finally { if (!present) await cleanupListeningPreview(); }
}
async function cleanupListeningPreview() {
  await preview?.terminate(); preview = undefined;
  for (const disposable of previewOwned.reverse()) disposable.dispose(); previewOwned = [];
}
export async function cleanupEnvironmentProbe() {
  await isolated(); await worker?.terminate(); worker = undefined;
  for (const disposable of disposables.reverse()) disposable.dispose(); disposables = [];
  await cleanupListeningPreview();
  return { commands: getDefaultStore().get(pluginCommandsAtom).filter(command => [id, "capability-listening-environment"].includes(command.pluginId)).length };
}
