/**
 * The IPC seam to the Rust plugin file manager, plus the module-URL builder
 * for the `raplugin://` protocol. Nothing here parses manifests — that's
 * lib/manifest.ts's job.
 */
import { invoke } from "@tauri-apps/api/core";

/** A plugin folder on disk: its id (folder name) and raw manifest text. */
export type PluginDiskEntry = { id: string; manifest: string; builtin?: boolean };

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

// ─── Plugin document collections (plugin_documents, migration v10) ───────────

/** Wire shape of the Rust `PluginDocumentRow` (camelCase serde). */
export type PluginDocumentRow = {
  id: string;
  json: string;
  bookId?: string;
  anchor?: string;
  updatedAt: string;
};

export function pluginDocsPut(
  pluginId: string,
  collection: string,
  id: string,
  json: string,
  options?: { bookId?: string; anchor?: string },
): Promise<void> {
  return invoke("plugin_docs_put", {
    pluginId,
    collection,
    id,
    json,
    bookId: options?.bookId ?? null,
    anchor: options?.anchor ?? null,
  });
}

export function pluginDocsGet(
  pluginId: string,
  collection: string,
  id: string,
): Promise<PluginDocumentRow | null> {
  return invoke<PluginDocumentRow | null>("plugin_docs_get", { pluginId, collection, id });
}

export function pluginDocsDelete(
  pluginId: string,
  collection: string,
  id: string,
): Promise<void> {
  return invoke("plugin_docs_delete", { pluginId, collection, id });
}

export function pluginDocsList(
  pluginId: string,
  collection: string,
  filter?: { bookId?: string; limit?: number; oldestFirst?: boolean },
): Promise<PluginDocumentRow[]> {
  return invoke<PluginDocumentRow[]>("plugin_docs_list", {
    pluginId,
    collection,
    bookId: filter?.bookId ?? null,
    limit: filter?.limit ?? null,
    oldestFirst: filter?.oldestFirst ?? null,
  });
}

/** Uninstall wipe — documents die with the plugin (their declared lifecycle). */
export function pluginDocsClear(pluginId: string): Promise<void> {
  return invoke("plugin_docs_clear", { pluginId });
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
