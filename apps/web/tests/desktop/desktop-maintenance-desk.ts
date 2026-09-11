import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { installedPluginsAtom, pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import { runPluginContribution } from "../../src/features/plugins/lib/run-result";
import { setPluginEnabled } from "../../src/features/plugins/runtime/plugin-host";

const id = "maintenance-desk";
let owned = false;
let originalEnabled = false;

async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) {
    throw Error("Maintenance acceptance requires isolated capability-e2e data");
  }
  return path;
}

/** Debug RepoDist already discovers built checkout plugins; never replace that installation. */
export async function prepareMaintenanceDesk() {
  const path = await isolated();
  const installed = getDefaultStore().get(installedPluginsAtom).find(plugin => plugin.manifest.id === id);
  if (owned || !installed?.builtin) throw Error("Expected unclaimed debug RepoDist Maintenance Desk");
  originalEnabled = installed.enabled;
  owned = true;
  if (!installed.enabled) await setPluginEnabled(id, true);
  return { path, id: installed.manifest.id, version: installed.manifest.version, enabled: installed.enabled,
    error: installed.error, contributions: inspectContributions(id).length };
}

export async function openMaintenanceDesk() {
  await isolated();
  if (!owned) throw Error("No owned Maintenance Desk installation");
  const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === id && item.id === "open");
  if (!command) throw Error("Maintenance Desk command is unavailable");
  await runPluginContribution(id, "Maintenance Desk", () => command.run(), { presentation: "dialog", owner: command.run });
}

export async function cleanupMaintenanceDesk() {
  await isolated();
  if (owned) {
    await setPluginEnabled(id, false);
    if (originalEnabled) await setPluginEnabled(id, true);
    owned = false;
  }
  return { installed: getDefaultStore().get(installedPluginsAtom).some(plugin => plugin.manifest.id === id),
    contributions: inspectContributions(id).length };
}
