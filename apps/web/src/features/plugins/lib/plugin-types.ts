/**
 * Plugin types as the app consumes them. The public authoring contract lives
 * in `@read-aware/plugin-types` (single source of truth, mirrored into the
 * marketplace repo's TypeScript template); this module re-exports it and adds
 * the app-internal registered shapes.
 */
import type {
  PluginCommand,
  PluginHeaderAction,
  PluginManifest,
  PluginSelectionAction,
  PluginToolDefinition,
} from "@read-aware/plugin-types";

export * from "@read-aware/plugin-types";

/** `<pluginId>:<contributionId>` — unique across all plugins. */
export type ContributionKey = string;

export function contributionKey(pluginId: string, id: string): ContributionKey {
  return `${pluginId}:${id}`;
}

export type RegisteredSelectionAction = PluginSelectionAction & {
  key: ContributionKey;
  pluginId: string;
  pluginName: string;
};

export type RegisteredHeaderAction = PluginHeaderAction & {
  key: ContributionKey;
  pluginId: string;
  pluginName: string;
};

export type RegisteredCommand = PluginCommand & {
  key: ContributionKey;
  pluginId: string;
  pluginName: string;
};

export type RegisteredTool = PluginToolDefinition & {
  key: ContributionKey;
  pluginId: string;
  pluginName: string;
};

/** An installed plugin as shown in settings; `error` records a failed activation. */
export type InstalledPlugin = {
  manifest: PluginManifest;
  enabled: boolean;
  error?: string;
};
