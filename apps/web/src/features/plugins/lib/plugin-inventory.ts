/**
 * The installed plugins as a diagnostics bundle lists them: identity, version
 * and state, no settings, data or grants. A plugin failure in the log names
 * `id@version`; this list says what else was installed and running beside it.
 */
import { errorCode } from "@read-aware/core";
import { getDefaultStore } from "jotai";
import { installedPluginsAtom } from "../state/plugin-store";
import type { InstalledPlugin } from "./plugin-types";

export type PluginInventoryEntry = {
  id: string;
  version: string;
  enabled: boolean;
  /** `builtin`, `marketplace`, `local`, or `unknown` for installs that predate provenance. */
  source: "builtin" | "marketplace" | "local" | "unknown";
  /** Why an enabled plugin is not running, as a stable error code. */
  failure?: string;
};

export function pluginInventoryOf(plugins: readonly InstalledPlugin[]): PluginInventoryEntry[] {
  return plugins.map((plugin) => ({
    id: plugin.manifest.id,
    version: plugin.manifest.version,
    enabled: plugin.enabled,
    source: plugin.builtin ? "builtin" : (plugin.installSource ?? "unknown"),
    ...(plugin.error ? { failure: errorCode(plugin.error) ?? "unknown" } : {}),
  }));
}

export function pluginInventory(): PluginInventoryEntry[] {
  return pluginInventoryOf(getDefaultStore().get(installedPluginsAtom));
}
