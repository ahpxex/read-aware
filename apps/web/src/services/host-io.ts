import { normalizeClipboardText, normalizeExternalUrl, normalizeHostExport, type HostExportFile } from "@read-aware/core";
import { exportTextFile } from "../platform/export-file";
import { openExternalUrl } from "../platform/external-link";
import { pluginDirectory } from "./plugin-directory";

/** The same bounded host effects for Agent ports and permission-gated plugins. */
export const hostIO = {
  listPlugins: pluginDirectory.list,
  writeClipboard: async (text: string, signal?: AbortSignal) => {
    signal?.throwIfAborted(); await navigator.clipboard.writeText(normalizeClipboardText(text));
  },
  exportFile: (file: HostExportFile, signal?: AbortSignal) => {
    signal?.throwIfAborted(); return exportTextFile(normalizeHostExport(file), signal);
  },
  openExternal: async (url: string, signal?: AbortSignal) => {
    signal?.throwIfAborted(); await openExternalUrl(normalizeExternalUrl(url));
  },
};
