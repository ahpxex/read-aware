import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { SettingChange } from "@read-aware/core";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { buildSettingsTools } from "../../../../../../../packages/agent/src/tools/settings-tools";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import { createSettingsDomain } from "../../../../domain/settings/domain";
import { localKV } from "../../../../platform/local-store";
import { invoke } from "../../../../platform/ipc";
import { appSettingsAtom, generalSettingsAtom } from "../../../../state/ui";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { startPluginWorker } from "../plugin-worker-host";
import { buildPluginSettingsView } from "../../lib/plugin-settings";

const id = "capability-settings-probe";
const prefix = `read-aware-plugin.${id}.`;
let worker: Awaited<ReturnType<typeof startPluginWorker>> | undefined;
const disposables: PluginDisposable[] = [];
let restore: SettingChange[] = [];
let events: unknown[] = [];
let unsubscribe: (() => void) | undefined;

async function assertIsolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw new Error("Settings probes require isolated capability-e2e data");
}

export async function prepareSettingsProbe() {
  await assertIsolated();
  if (worker) throw new Error("Settings probe is already running");
  const settings = createSettingsDomain("user");
  restore = await Promise.all(["appearance.theme", "appearance.motion", "general.startView"].map(async path => {
    const value = await settings.queries.read(path);
    return { path, value: value.value };
  }));
  events = [];
  unsubscribe = settings.events.subscribe(event => events.push(event));
  const manifest: PluginManifest = {
    id, name: "Settings capability probe", version: "1.0.0", schemaVersion: 1, description: "Atomic settings validation",
    permissions: [], requires: { domains: { settings: "^1.1.0" }, services: { storage: "^2.0.0" } },
    settingsAccess: { write: ["appearance.theme", "appearance.motion", "general.startView"] },
    settings: [{ id: "enabled", kind: "toggle", label: "Enabled", value: false }],
  };
  worker = await startPluginWorker(manifest, "0.5.4", disposables, { moduleUrl: new URL("./settings-probe.ts", import.meta.url).href });
  await worker.checkHealth(); worker.promote();
  return settingsProbeSnapshot();
}

export function settingsProbeSnapshot() {
  const store = getDefaultStore();
  return { appearance: store.get(appSettingsAtom), general: store.get(generalSettingsAtom), events: [...events] };
}

export async function agentSettings(changes: SettingChange[]) {
  await assertIsolated();
  const tool = buildSettingsTools({ kind: "global", threadId: "settings-e2e" }, buildRuntimeDeps()).find(tool => tool.name === "update_settings")!;
  try {
    const result = await tool.execute("settings-e2e", { changes });
    if (result.content[0]?.type !== "text") throw new Error("Expected settings tool text result");
    const parsed = JSON.parse(result.content[0].text);
    return { status: "committed", changed: parsed.changed, snapshot: settingsProbeSnapshot() };
  } catch (error) {
    return { status: "failed", code: error && typeof error === "object" && "code" in error ? error.code : null, snapshot: settingsProbeSnapshot() };
  }
}

export async function pluginSettings(changes: SettingChange[]) {
  await assertIsolated();
  await localKV.setItemAsync(prefix + "changes", JSON.stringify(changes));
  const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === "update");
  if (!command) throw new Error("Settings probe command is unavailable");
  await command.run();
  const disk = await invoke<Record<string, string>>("load_kv_all");
  return { result: JSON.parse(disk[prefix + "result"] ?? "null"), snapshot: settingsProbeSnapshot() };
}

export async function formSettings(enabled: boolean) {
  await assertIsolated();
  if (!worker) throw new Error("Settings probe is unavailable");
  const form = buildPluginSettingsView(worker.manifest)!;
  let result: unknown;
  try { await form.onSubmit({ enabled }); result = { status: "committed" }; }
  catch (error) { result = { status: "failed", code: error && typeof error === "object" && "code" in error ? error.code : null }; }
  const inspect = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === "observed")!;
  return { result, observed: (await inspect.run())?.toast };
}

export async function cleanupSettingsProbe() {
  await assertIsolated();
  try {
    await worker?.terminate();
  } finally {
    worker = undefined;
    for (const disposable of disposables.splice(0).reverse()) disposable.dispose();
    unsubscribe?.(); unsubscribe = undefined;
    if (restore.length) await createSettingsDomain("user").commands.update(restore);
    restore = [];
    for (const key of ["changes", "result", "settings"]) await localKV.removeItemAsync(prefix + key);
  }
  return { contributions: inspectContributions(id).length };
}
