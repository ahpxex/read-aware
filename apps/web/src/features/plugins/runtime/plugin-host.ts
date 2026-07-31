/**
 * The plugin lifecycle owner: enumerate installed folders, start each enabled
 * plugin in its sandbox, and keep the installed-plugins atom truthful.
 * Desktop-only — in a plain browser (dev/Storybook) every function is a no-op.
 * A broken plugin records its error and stays inert; it must never take the app
 * down.
 *
 * Plugin CODE runs in a Worker (plugin-sandbox.worker.ts), not here. This
 * module only decides what may start and holds the handle for tearing it down.
 */
import { getVersion } from "@tauri-apps/api/app";
import { getDefaultStore } from "jotai";
import { isTauri } from "../../../platform/environment";
import { PluginManifestError, parseManifestJson, versionSatisfies } from "../lib/manifest";
import type {
  InstalledPlugin,
  PluginDisposable,
  PluginManifest,
} from "../lib/plugin-types";
import {
  forgetPluginEnabled,
  installedPluginsAtom,
  isPluginEnabled,
  persistPluginEnabled,
  setInstalledPlugins,
  updateInstalledPlugin,
} from "../state/plugin-store";
import {
  installPluginFilesCmd,
  installPluginFromDir,
  installPluginFromZip,
  listPluginEntries,
  pluginDocsClear,
  uninstallPluginFiles,
  type PluginDiskEntry,
  type PluginFilePayload,
} from "./plugin-backend";
import { startPluginWorker, type SandboxedPlugin } from "./plugin-worker-host";
import { onAppEvent } from "../../../platform/app-events";
import { unbindVirtualBook } from "../lib/virtual-books";

type ActivePlugin = {
  manifest: PluginManifest;
  sandbox: SandboxedPlugin;
  disposables: PluginDisposable[];
};

const active = new Map<string, ActivePlugin>();
let appVersion = "0.0.0";
let initialized = false;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getInstalled(): InstalledPlugin[] {
  return getDefaultStore().get(installedPluginsAtom);
}

/** Boot entry — enumerate plugin folders and activate the enabled ones. */
export async function initializePlugins(): Promise<void> {
  if (!isTauri() || initialized) return;
  initialized = true;

  try {
    appVersion = await getVersion();
  } catch {
    // Advisory only — minAppVersion checks degrade to permissive.
  }

  let entries;
  try {
    entries = await listPluginEntries();
  } catch (error) {
    console.error("[plugins] failed to enumerate installed plugins", error);
    return;
  }

  const installed: InstalledPlugin[] = [];
  for (const entry of entries) {
    try {
      const manifest = parseManifestJson(entry.manifest);
      if (manifest.id !== entry.id) {
        throw new PluginManifestError(
          `manifest.id "${manifest.id}" does not match folder name "${entry.id}"`,
        );
      }
      installed.push({
        manifest,
        enabled: isPluginEnabled(manifest.id, entry.builtin === true),
        builtin: entry.builtin === true,
      });
    } catch (error) {
      // Keep the broken folder visible in settings instead of hiding it.
      installed.push({
        manifest: { id: entry.id, name: entry.id, version: "0.0.0" },
        enabled: false,
        error: errorMessage(error),
      });
    }
  }
  setInstalledPlugins(installed);

  await Promise.all(
    installed
      .filter((plugin) => plugin.enabled && !plugin.error)
      .map((plugin) => activatePlugin(plugin.manifest)),
  );

  // Any deletion path (shelf UI included) must release the virtual-book
  // binding, or the registry leaks dead entries.
  onAppEvent("book-removed", ({ bookId }) => unbindVirtualBook(bookId));

  // Best-effort teardown on app quit — disposables run synchronously; async
  // deactivate() work races the process, which is the platform's nature.
  window.addEventListener("pagehide", () => {
    for (const id of [...active.keys()]) void deactivatePlugin(id);
  });
}

/**
 * Start one plugin inside its sandbox; failures are recorded on its settings
 * entry. The plugin's code never enters this realm — `startPluginWorker` runs
 * it in a Worker and brokers everything through its permission-gated context.
 */
async function activatePlugin(manifest: PluginManifest): Promise<void> {
  if (active.has(manifest.id)) return;
  try {
    if (manifest.minAppVersion && !versionSatisfies(appVersion, manifest.minAppVersion)) {
      throw new Error(`requires app version ${manifest.minAppVersion} or newer`);
    }
    const installed = getInstalled().find((plugin) => plugin.manifest.id === manifest.id);
    if (manifest.permissions?.includes("reader:modes") && !installed?.builtin) {
      throw new Error("reader:modes is currently reserved for built-in plugins");
    }
    const disposables: PluginDisposable[] = [];
    const sandbox = await startPluginWorker(manifest, appVersion, disposables);
    active.set(manifest.id, { manifest, sandbox, disposables });
    updateInstalledPlugin(manifest.id, { error: undefined });
  } catch (error) {
    console.error(`[plugins] activation of "${manifest.id}" failed`, error);
    updateInstalledPlugin(manifest.id, { error: errorMessage(error) });
  }
}

/** Dispose every contribution, then tear the plugin's realm down. */
async function deactivatePlugin(id: string): Promise<void> {
  const entry = active.get(id);
  if (!entry) return;
  active.delete(id);
  for (const disposable of entry.disposables) {
    try {
      disposable.dispose();
    } catch (error) {
      console.error(`[plugins] dispose from "${id}" failed`, error);
    }
  }
  try {
    await entry.sandbox.terminate();
  } catch (error) {
    console.error(`[plugins] terminating "${id}" failed`, error);
  }
}

/** Settings toggle — persists, then (de)activates immediately, no restart. */
export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  persistPluginEnabled(id, enabled);
  updateInstalledPlugin(id, { enabled, error: undefined });
  if (enabled) {
    const plugin = getInstalled().find((entry) => entry.manifest.id === id);
    if (plugin) await activatePlugin(plugin.manifest);
  } else {
    await deactivatePlugin(id);
  }
}

/**
 * Adopt a freshly written plugin folder: validate the manifest properly,
 * replace any running instance, enable, and activate. Shared by both install
 * paths (local folder and marketplace). Throws with a readable message — the
 * settings panel surfaces it.
 */
async function adoptDiskEntry(entry: PluginDiskEntry): Promise<InstalledPlugin> {
  const manifest = parseManifestJson(entry.manifest);
  if (manifest.id !== entry.id) {
    throw new PluginManifestError(
      `manifest.id "${manifest.id}" does not match folder name "${entry.id}"`,
    );
  }

  // A bundled plugin's id is not installable-over: the built-in cannot be
  // uninstalled, so adopting this copy would leave two same-id plugins with
  // no clean way out. The files were already written — remove them again.
  const existing = getInstalled().find((plugin) => plugin.manifest.id === manifest.id);
  if (existing?.builtin) {
    await uninstallPluginFiles(manifest.id).catch(() => {});
    throw new Error(`"${manifest.id}" is a built-in plugin and cannot be replaced`);
  }

  // Replacing a running plugin: tear the old instance down first.
  await deactivatePlugin(manifest.id);

  const plugin: InstalledPlugin = { manifest, enabled: true };
  setInstalledPlugins([
    ...getInstalled().filter((existing) => existing.manifest.id !== manifest.id),
    plugin,
  ]);
  persistPluginEnabled(manifest.id, true);
  await activatePlugin(manifest);

  const after = getInstalled().find((existing) => existing.manifest.id === manifest.id);
  return after ?? plugin;
}

/** Install (or replace) from a local folder picked by the user. */
export function installPlugin(srcDir: string): Promise<InstalledPlugin> {
  return installPluginFromDir(srcDir).then(adoptDiskEntry);
}

/** Install (or replace) from a zip archive picked by the user. */
export function installPluginZip(zipPath: string): Promise<InstalledPlugin> {
  return installPluginFromZip(zipPath).then(adoptDiskEntry);
}

/** Install (or replace) from fetched file contents (the marketplace path). */
export function installPluginFiles(
  id: string,
  files: PluginFilePayload[],
): Promise<InstalledPlugin> {
  return installPluginFilesCmd(id, files).then(adoptDiskEntry);
}

/**
 * Remove the plugin's files. Its KV storage is deliberately kept (settings
 * survive a reinstall); its DOCUMENT collections are wiped — documents'
 * declared lifecycle is the plugin's own.
 */
export async function uninstallPlugin(id: string): Promise<void> {
  const target = getInstalled().find((entry) => entry.manifest.id === id);
  if (target?.builtin) throw new Error(`"${id}" is a built-in plugin`);
  await deactivatePlugin(id);
  await uninstallPluginFiles(id);
  await pluginDocsClear(id).catch((error) => {
    console.error(`[plugins] document wipe for "${id}" failed`, error);
  });
  forgetPluginEnabled(id);
  setInstalledPlugins(getInstalled().filter((entry) => entry.manifest.id !== id));
}
