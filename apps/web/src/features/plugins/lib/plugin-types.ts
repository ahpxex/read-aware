/**
 * Plugin types as the app consumes them. The public authoring contract lives
 * in `@read-aware/plugin-types` (single source of truth, mirrored into the
 * marketplace repo's TypeScript template); this module re-exports it and adds
 * the app-internal registered shapes.
 */
import type {
  PluginCommand,
  PluginFontContribution,
  PluginHeaderAction,
  PluginManifest,
  PluginReaderMode,
  PluginSelectionAction,
  PluginThemeContribution,
  PluginToolDefinition,
  PluginVoice,
  PluginVoiceProvider,
} from "@read-aware/plugin-types";

export * from "@read-aware/plugin-types";

/** `<pluginId>:<contributionId>` — unique across all plugins. */
export type ContributionKey = string;

export function contributionKey(pluginId: string, id: string): ContributionKey {
  return `${pluginId}:${id}`;
}

/**
 * i18n catalog key for a permission's one-sentence description. Permission
 * ids contain ":" (i18next's namespace separator), so catalog keys use the
 * "_" form: `shelf:read` → `settings.permission.shelf_read`.
 */
export function permissionLabelKey(permission: string): string {
  return `settings.permission.${permission.replace(/:/g, "_")}`;
}

/**
 * i18n catalog key for a permission's short noun name — what a Badge/Tag
 * carries. The sentence from `permissionLabelKey` is the description shown
 * where consent needs it spelled out (the install dialog).
 */
export function permissionNameKey(permission: string): string {
  return `settings.permissionName.${permission.replace(/:/g, "_")}`;
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

/**
 * A reader mode as the HOST holds it.
 *
 * `segmentText` widens to allow a promise: the plugin still writes an ordinary
 * synchronous function, but its code lives in a Worker now, so the call crosses
 * a realm on the way here (see plugin-worker-host.ts). Segmentation runs once
 * per section and the result is cached, so awaiting it costs nothing per step.
 */
export type RegisteredReaderMode = Omit<PluginReaderMode, "segmentText"> & {
  segmentText: (
    input: Parameters<PluginReaderMode["segmentText"]>[0],
  ) => ReturnType<PluginReaderMode["segmentText"]> | Promise<ReturnType<PluginReaderMode["segmentText"]>>;
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

/**
 * A theme as the host holds it: the validated manifest declaration plus its
 * provenance. `typography.fontFamily` self-references (`plugin:<fontId>`)
 * have been expanded to the full stored ref at registration.
 */
export type RegisteredVoiceProvider = PluginVoiceProvider & {
  key: ContributionKey;
  pluginId: string;
  pluginName: string;
  /** Snapshot taken at registration (and re-taken on settings changes), so
   *  pickers and the settings catalog read voices synchronously. */
  voices: PluginVoice[];
};

export type RegisteredPluginTheme = PluginThemeContribution & {
  key: ContributionKey;
  pluginId: string;
  pluginName: string;
};

/** A bundled font as the host holds it. */
export type RegisteredPluginFont = PluginFontContribution & {
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
