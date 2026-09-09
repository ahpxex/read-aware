import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { createSettingsDomain } from "../../../../domain/settings/domain";
import { afterSettingsWrites } from "../../../../domain/settings/observation-sources";
import { localKV, replaceLocalKVPrefix, setLocalKVBatch } from "../../../../platform/local-store";
import { APP_SETTINGS_KEY, getAppSettings } from "../../../settings/lib/app-settings";
import { SHELF_VIEW_KEY } from "../../../shelf/lib/shelf-view";
import { appSettingsAtom } from "../../../../state/ui";
import { pluginCommandsAtom, registerThemeContribution } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { contributionKey } from "../../lib/plugin-types";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";
import { runPluginContribution } from "../../lib/run-result";
import { buildSettingsTools } from "../../../../../../../packages/agent/src/tools/settings-tools";
import { buildRuntimeDeps } from "../../../ai/agent/ports";
import profileManifest from "../../../../../../../plugins/workspace-profiles/manifest.json";

const prefix = "read-aware-settings-observation-proof";
const workers: SandboxedPlugin[] = [], owned: PluginDisposable[] = [];
let theme: PluginDisposable | undefined;
async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Use isolated capability-e2e data");
  return path;
}
export async function prepareSettingsObservationProbe() {
  const path = await isolated();
  if (workers.length || localKV.getItem(prefix)) throw Error("Settings observation probe needs cleanup first");
  await localKV.setItemAsync(prefix, JSON.stringify([APP_SETTINGS_KEY, SHELF_VIEW_KEY].map(key => [key, localKV.getItem(key)])));
  for (const role of ["empty", "read", "write"] as const) {
    const manifest: PluginManifest = { id: `capability-settings-observation-${role}`, name: role, version: "1.0.0", schemaVersion: 1,
      permissions: [], settingsAccess: role === "empty" ? {} : { [role]: ["appearance.theme", "shelf.layout"] },
      requires: { domains: { settings: "^1.6.0" } } };
    const worker = await startPluginWorker(manifest, "0.5.4", owned, { moduleUrl: new URL("./settings-observation-probe.ts", import.meta.url).href });
    workers.push(worker); await worker.checkHealth(); worker.promote();
  }
  const worker = await startPluginWorker({ ...profileManifest, id: "capability-settings-observation-profiles" } as PluginManifest, "0.5.4", owned,
    { moduleUrl: new URL("../../../../../../../plugins/workspace-profiles/dist/main.js", import.meta.url).href });
  workers.push(worker); await worker.checkHealth(); worker.promote();
  return { path, snapshot: await createSettingsDomain("agent").queries.snapshot({ section: "appearance" }) };
}
export async function settingsObservationActor(role: "empty" | "read" | "write", command = "inspect") {
  await isolated(); const contribution = getDefaultStore().get(pluginCommandsAtom).find(c => c.pluginId === `capability-settings-observation-${role}` && c.id === command);
  if (!contribution) throw Error("Missing probe command");
  return JSON.parse((await contribution.run())!.toast!);
}
export async function changeObservedTheme(source: "native" | "remote" | "restore", value: "light" | "dark" | "system") {
  await isolated(); const next = { ...getAppSettings(), theme: value };
  if (source === "native") getDefaultStore().set(appSettingsAtom, next);
  else if (source === "remote") localKV.setItem(APP_SETTINGS_KEY, JSON.stringify(next), "remote");
  else await replaceLocalKVPrefix(APP_SETTINGS_KEY, { "": JSON.stringify(next) });
  return afterSettingsWrites(() => getAppSettings());
}
export async function settingsObservationAgent(value?: "light" | "dark" | "system", bookScope = false) {
  await isolated();
  const name = value ? "update_settings" : "get_settings";
  const tool = buildSettingsTools(bookScope ? { kind: "book", bookId: "07ef226e-1ebc-47b6-8dc9-d09109448d22" } : { kind: "global", threadId: "settings-observation" }, buildRuntimeDeps()).find(tool => tool.name === name)!;
  const result = await tool.execute("settings-observation", value ? { changes: [{ path: "appearance.theme", value }] } : { section: "appearance" });
  if (result.content[0]?.type !== "text") throw Error("Missing tool text"); return JSON.parse(result.content[0].text);
}
export async function toggleObservedCatalog() {
  await isolated();
  if (theme) { theme.dispose(); theme = undefined; }
  else theme = registerThemeContribution({ id: "test", key: contributionKey("capability-settings-observation-theme", "test"), pluginId: "capability-settings-observation-theme", pluginName: "Observation Theme", name: "Observation Theme", polarity: "light", app: {} });
  return !!theme;
}
export async function openObservedProfiles() {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(c => c.pluginId === "capability-settings-observation-profiles" && c.id === "open")!;
  await runPluginContribution(command.pluginId, "Workspace Profiles", () => command.run(), { presentation: "dialog", owner: command.run });
}
export async function cleanupSettingsObservationProbe() {
  const path = await isolated(); theme?.dispose(); theme = undefined;
  const ids = workers.map(worker => worker.manifest.id);
  for (const worker of workers.splice(0)) await worker.terminate();
  for (const disposable of owned.splice(0).reverse()) disposable.dispose();
  const saved = localKV.getItem(prefix);
  if (saved) { await setLocalKVBatch(new Map(JSON.parse(saved) as [string, string | null][])); await localKV.removeItemAsync(prefix); }
  return { path, restored: !localKV.getItem(prefix), contributions: ids.reduce((sum, id) => sum + inspectContributions(id).length, 0) };
}
