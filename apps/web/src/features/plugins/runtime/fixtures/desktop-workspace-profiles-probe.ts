import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { appSettingsAtom, shelfViewAtom } from "../../../../state/ui";
import { getShelfView } from "../../../shelf/lib/shelf-view";
import { runPluginContribution } from "../../lib/run-result";
import { pluginCommandsAtom, pluginToolsAtom } from "../../state/plugin-store";
import { startPluginWorker, type SandboxedPlugin } from "../plugin-worker-host";
import { pluginDocsClear, pluginDocsList } from "../plugin-backend";
import manifest from "../../../../../../../plugins/workspace-profiles/manifest.json";
import { PROFILE_PATHS } from "../../../../../../../plugins/workspace-profiles/src/profiles";

const id = "capability-workspace-profiles";
const owned: PluginDisposable[] = [];
let worker: SandboxedPlugin | undefined;
export const workspaceProfilePaths = PROFILE_PATHS;
async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Use isolated capability-e2e data");
}
export async function prepareWorkspaceProfilesProbe() {
  await isolated();
  if (worker) throw Error("Probe already running");
  worker = await startPluginWorker({ ...manifest, id } as PluginManifest, "0.5.4", owned,
    { moduleUrl: new URL("../../../../../../../plugins/workspace-profiles/dist/main.js", import.meta.url).href });
  await worker.checkHealth(); worker.promote();
  return workspaceProfilesSnapshot();
}
export async function workspaceProfilesSnapshot() {
  await isolated();
  const store = getDefaultStore();
  return { view: store.get(shelfViewAtom), storedView: getShelfView(), appearance: store.get(appSettingsAtom),
    profiles: await pluginDocsList(id, "profiles") };
}
export async function workspaceProfileTool(params: Record<string, unknown>) {
  await isolated();
  const tool = getDefaultStore().get(pluginToolsAtom).find(tool => tool.pluginId === id && tool.name === "workspace_profiles");
  if (!tool) throw Error("Workspace tool unavailable");
  return tool.execute(params);
}
export async function openWorkspaceProfilesProbe() {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === "open");
  if (!command) throw Error("Workspace command unavailable");
  await runPluginContribution(id, manifest.name, () => command.run(), { presentation: "dialog", owner: command.run });
}
export async function cleanupWorkspaceProfilesProbe() {
  await isolated();
  await worker?.terminate(); worker = undefined;
  for (const disposable of owned.splice(0).reverse()) disposable.dispose();
  await pluginDocsClear(id);
  return { profiles: (await pluginDocsList(id, "profiles")).length,
    tools: getDefaultStore().get(pluginToolsAtom).filter(tool => tool.pluginId === id).length,
    commands: getDefaultStore().get(pluginCommandsAtom).filter(command => command.pluginId === id).length };
}
