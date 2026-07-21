/**
 * The plugin lifecycle owner: enumerate installed folders, load entry modules
 * over `raplugin://`, run activate/deactivate, and keep the installed-plugins
 * atom truthful. Desktop-only — in a plain browser (dev/Storybook) every
 * function is a no-op. A broken plugin records its error and stays inert;
 * it must never take the app down.
 */
import { getVersion } from "@tauri-apps/api/app";
import { getDefaultStore } from "jotai";
import { isTauri } from "../../../platform/environment";
import { PluginManifestError, parseManifestJson, versionSatisfies } from "../lib/manifest";
import type {
  InstalledPlugin,
  PluginDisposable,
  PluginManifest,
  PluginModule,
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
  installPluginFromDir,
  listPluginEntries,
  pluginModuleUrl,
  uninstallPluginFiles,
} from "./plugin-backend";
import { buildPluginContext } from "./plugin-context";

type ActivePlugin = {
  manifest: PluginManifest;
  module: PluginModule;
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
      installed.push({ manifest, enabled: isPluginEnabled(manifest.id) });
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
}

/** Load + activate one plugin; failures are recorded on its settings entry. */
async function activatePlugin(manifest: PluginManifest): Promise<void> {
  if (active.has(manifest.id)) return;
  try {
    if (manifest.minAppVersion && !versionSatisfies(appVersion, manifest.minAppVersion)) {
      throw new Error(`requires app version ${manifest.minAppVersion} or newer`);
    }
    const url = pluginModuleUrl(manifest.id, manifest.main ?? "main.js");
    const loaded = (await import(/* @vite-ignore */ url)) as { default?: PluginModule };
    const entry = loaded.default;
    if (!entry || typeof entry.activate !== "function") {
      throw new Error("entry module must default-export an object with activate()");
    }
    const disposables: PluginDisposable[] = [];
    const ctx = buildPluginContext(manifest, appVersion, disposables);
    await entry.activate(ctx);
    active.set(manifest.id, { manifest, module: entry, disposables });
    updateInstalledPlugin(manifest.id, { error: undefined });
  } catch (error) {
    console.error(`[plugins] activation of "${manifest.id}" failed`, error);
    updateInstalledPlugin(manifest.id, { error: errorMessage(error) });
  }
}

/** Dispose every contribution, then let the plugin release its own resources. */
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
    await entry.module.deactivate?.();
  } catch (error) {
    console.error(`[plugins] deactivate() of "${id}" failed`, error);
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
 * Install (or replace) from a local folder: copy via Rust, validate the
 * manifest properly, enable, and activate. Throws with a readable message —
 * the settings panel surfaces it.
 */
export async function installPlugin(srcDir: string): Promise<InstalledPlugin> {
  const entry = await installPluginFromDir(srcDir);
  const manifest = parseManifestJson(entry.manifest);
  if (manifest.id !== entry.id) {
    throw new PluginManifestError(
      `manifest.id "${manifest.id}" does not match folder name "${entry.id}"`,
    );
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

/** Remove the plugin's files; its namespaced storage is deliberately kept. */
export async function uninstallPlugin(id: string): Promise<void> {
  await deactivatePlugin(id);
  await uninstallPluginFiles(id);
  forgetPluginEnabled(id);
  setInstalledPlugins(getInstalled().filter((entry) => entry.manifest.id !== id));
}
