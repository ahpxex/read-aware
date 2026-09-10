import { normalizePluginDirectoryQuery, type PluginDirectoryEntry, type PluginDirectoryPage, type PluginDirectoryQuery } from "@read-aware/core";
import { getDefaultStore } from "jotai";
import { installedPluginsAtom } from "../features/plugins/state/plugin-store";
import type { InstalledPlugin } from "../features/plugins/lib/plugin-types";
import { createLogger } from "../platform/logger";

const log = createLogger("plugin-directory");
export function pluginDirectoryPage(installed: readonly InstalledPlugin[], query?: PluginDirectoryQuery): PluginDirectoryPage {
  const { search, offset, limit } = normalizePluginDirectoryQuery(query);
  const plugins: PluginDirectoryEntry[] = installed.map(({ manifest, enabled, builtin, error }) => ({
    id: manifest.id, name: typeof manifest.name === "string" ? manifest.name : manifest.id,
    version: manifest.version, builtin: !!builtin, enabled, activationFailed: !!error,
  })).filter(plugin => !search || `${plugin.id} ${plugin.name}`.toLowerCase().includes(search)).sort((a, b) => a.id.localeCompare(b.id));
  return { plugins: plugins.slice(offset, offset + limit), total: plugins.length, offset,
    nextOffset: offset + limit < plugins.length ? offset + limit : null };
}
export const pluginDirectory = {
  list: async (query?: PluginDirectoryQuery) => pluginDirectoryPage(getDefaultStore().get(installedPluginsAtom), query),
  observe: (query: PluginDirectoryQuery, handler: (page: PluginDirectoryPage) => unknown) => {
    const accepted = normalizePluginDirectoryQuery(query), store = getDefaultStore();
    const publish = () => {
      try { Promise.resolve(handler(pluginDirectoryPage(store.get(installedPluginsAtom), accepted))).catch(error => log.warn("Plugin directory observer failed", error)); }
      catch (error) { log.warn("Plugin directory observer failed", error); }
    };
    const off = store.sub(installedPluginsAtom, publish); publish(); return off;
  },
};
