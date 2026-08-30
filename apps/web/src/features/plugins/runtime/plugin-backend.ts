/**
 * The IPC seam to the Rust plugin file manager, plus the module-URL builder
 * for the `raplugin://` protocol. Nothing here parses manifests — that's
 * lib/manifest.ts's job.
 */
import { invoke } from "../../../platform/ipc";

/** A plugin folder on disk: its id (folder name) and raw manifest text. */
export type PluginDiskEntry = { id: string; manifest: string; builtin?: boolean };

export function listPluginEntries(): Promise<PluginDiskEntry[]> {
  return invoke<PluginDiskEntry[]>("plugins_list");
}

export type PluginCandidateDiskEntry = {
  token: string;
  id: string;
  manifest: string;
};

export function stagePluginFromDir(srcDir: string): Promise<PluginCandidateDiskEntry> {
  return invoke<PluginCandidateDiskEntry>("plugins_stage_dir", { srcDir });
}

export function stagePluginFromZip(zipPath: string): Promise<PluginCandidateDiskEntry> {
  return invoke<PluginCandidateDiskEntry>("plugins_stage_zip", { zipPath });
}

export type PluginFilePayload = {
  path: string;
  content: string;
  /** `"base64"` for binary payloads (fonts, images); omit for UTF-8 text. */
  encoding?: "base64";
};

export function stagePluginFiles(
  id: string,
  files: PluginFilePayload[],
): Promise<PluginCandidateDiskEntry> {
  return invoke<PluginCandidateDiskEntry>("plugins_stage_files", { id, files });
}

export function commitPluginCandidate(token: string): Promise<PluginDiskEntry> {
  return invoke<PluginDiskEntry>("plugins_commit_candidate", { token });
}

export function discardPluginCandidate(token: string): Promise<void> {
  return invoke("plugins_discard_candidate", { token });
}

export function rollbackPluginFiles(id: string): Promise<PluginDiskEntry> {
  return invoke<PluginDiskEntry>("plugins_rollback", { id });
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

export type PluginDocumentSnapshotRow = PluginDocumentRow & {
  collection: string;
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

export function pluginDocsSnapshot(pluginId: string): Promise<PluginDocumentSnapshotRow[]> {
  return invoke<PluginDocumentSnapshotRow[]>("plugin_docs_snapshot", { pluginId });
}

export function pluginDocsRestore(
  pluginId: string,
  rows: PluginDocumentSnapshotRow[],
): Promise<void> {
  return invoke("plugin_docs_restore", { pluginId, rows });
}

let loadCounter = 0;

/**
 * URL for a file inside an installed plugin's folder, served over the
 * `raplugin://` protocol. Mirrors Tauri's convertFileSrc() scheme mapping:
 * Windows AND Android serve custom protocols over `http://<scheme>.localhost`
 * (their webviews cannot intercept a custom scheme directly), everywhere
 * else as `<scheme>://localhost/`. Missing the Android half of that rule
 * once left every plugin failing activation there with "Failed to fetch
 * dynamically imported module: raplugin://…".
 */
export function pluginAssetUrl(id: string, path: string): string {
  const httpMapped =
    navigator.userAgent.includes("Windows") || navigator.userAgent.includes("Android");
  const base = httpMapped ? "http://raplugin.localhost/" : "raplugin://localhost/";
  return `${base}${id}/${path}`;
}

/**
 * URL for a plugin's entry module. The query param busts the ES module cache
 * so a reinstall or re-enable always executes fresh code.
 */
export function pluginModuleUrl(id: string, main: string): string {
  loadCounter += 1;
  return `${pluginAssetUrl(id, main)}?v=${loadCounter}-${Date.now()}`;
}

/** Entry URL for a separately staged update candidate. */
export function pluginCandidateModuleUrl(token: string, main: string): string {
  loadCounter += 1;
  const base = pluginAssetUrl("__candidate", `${token}/${main}`);
  return `${base}?v=${loadCounter}-${Date.now()}`;
}
