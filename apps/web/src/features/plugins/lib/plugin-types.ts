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
  PluginReaderMode,
  PluginSelectionAction,
  PluginToolDefinition,
} from "@read-aware/plugin-types";

export * from "@read-aware/plugin-types";

/** `<pluginId>:<contributionId>` — unique across all plugins. */
export type ContributionKey = string;

export function contributionKey(pluginId: string, id: string): ContributionKey {
  return `${pluginId}:${id}`;
}

/**
 * i18n catalog key for a permission's human label. Permission ids contain ":"
 * (i18next's namespace separator), so catalog keys use the "_" form:
 * `books:read` → `settings.permission.books_read`.
 */
export function permissionLabelKey(permission: string): string {
  return `settings.permission.${permission.replace(/:/g, "_")}`;
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

export type RegisteredReaderMode = PluginReaderMode & {
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
  /** Shipped in the app bundle: default-enabled, not uninstallable. */
  builtin?: boolean;
  error?: string;
};
