/**
 * The IPC seam to the Rust plugin file manager, plus the module-URL builder
 * for the `raplugin://` protocol. Nothing here parses manifests — that's
 * lib/manifest.ts's job.
 */
import { invoke } from "@tauri-apps/api/core";

/** A plugin folder on disk: its id (folder name) and raw manifest text. */
export type PluginDiskEntry = { id: string; manifest: string };

export function listPluginEntries(): Promise<PluginDiskEntry[]> {
  return invoke<PluginDiskEntry[]>("plugins_list");
}

export function installPluginFromDir(srcDir: string): Promise<PluginDiskEntry> {
  return invoke<PluginDiskEntry>("plugins_install", { srcDir });
}

/** Raw manifest.json text of a candidate folder — read before consent/copy. */
export function readPluginManifestFromDir(srcDir: string): Promise<string> {
  return invoke<string>("plugins_read_manifest", { srcDir });
}

export type PluginFilePayload = { path: string; content: string };

export function installPluginFilesCmd(
  id: string,
  files: PluginFilePayload[],
): Promise<PluginDiskEntry> {
  return invoke<PluginDiskEntry>("plugins_install_files", { id, files });
}

export function uninstallPluginFiles(id: string): Promise<void> {
  return invoke("plugins_uninstall", { id });
}

let loadCounter = 0;

/**
 * URL for a plugin's entry module. Mirrors Tauri's convertFileSrc() scheme
 * mapping: Windows serves custom protocols over `http://<scheme>.localhost`,
 * everywhere else as `<scheme>://localhost/`. The query param busts the ES
 * module cache so a reinstall or re-enable always executes fresh code.
 */
export function pluginModuleUrl(id: string, main: string): string {
  const windows = navigator.userAgent.includes("Windows");
  const base = windows ? "http://raplugin.localhost/" : "raplugin://localhost/";
  loadCounter += 1;
  return `${base}${id}/${main}?v=${loadCounter}-${Date.now()}`;
}
