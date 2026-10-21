/**
 * Plugin types as the app consumes them. The public authoring contract lives
 * in `@read-aware/plugin-types` (single source of truth, mirrored into the
 * marketplace repo's TypeScript template); this module re-exports it and adds
 * the app-internal registered shapes.
 */
import type {
  PluginCommand,
  PluginContextAction,
  PluginFontContribution,
  PluginHeaderAction,
  PluginManifest,
  PluginAgentContextProvider,
  PluginAgentRetrievalProvider,
  PluginMemoryCandidateProvider,
  PluginReaderMode,
  PluginSelectionAction,
  PluginThemeContribution,
  PluginToolDefinition,
  PluginVoice,
  PluginVoiceProvider,
  PluginBookAccess,
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
 * "_" form: `library:read` → `settings.permission.library_read`.
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

export type RegisteredContextAction = PluginContextAction & {
  key: ContributionKey;
  pluginId: string;
  pluginName: string;
};

/**
 * A reader mode as the HOST holds it.
 *
 * Segmentation crosses a Worker boundary even for synchronous providers.
 * The public contract also permits asynchronous providers since readerModes 1.1.
 */
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
  /** Host-installed authorization closure; never accepted from plugin input. */
  resolveBookCards?: import("../runtime/plugin-book-cards").PluginBookCardResolver;
  /** Host-owned object scope; used again when the Agent invokes this callback. */
  bookAccess?: PluginBookAccess;
  assertBookAccess?: (bookId: string) => void;
};

export type RegisteredAgentContextProvider = PluginAgentContextProvider & {
  key: ContributionKey;
  pluginId: string;
  pluginName: string;
  /** Host-owned realm guard; plugin-supplied values are never retained. */
  readingIntentLifetime?: AbortSignal;
  bookAccess?: PluginBookAccess;
  assertBookAccess?: (bookId: string) => void;
};

export type RegisteredAgentRetrievalProvider = PluginAgentRetrievalProvider & {
  key: ContributionKey;
  pluginId: string;
  pluginName: string;
  bookAccess?: PluginBookAccess;
  assertBookAccess?: (bookId: string) => void;
};

export type RegisteredMemoryCandidateProvider = PluginMemoryCandidateProvider & {
  key: ContributionKey;
  pluginId: string;
  pluginName: string;
  /** Host-owned object grant used when the Agent invokes this callback. */
  bookAccess?: PluginBookAccess;
  assertBookAccess?: (bookId: string) => void;
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
  /** Host-created raster URL, scoped to this exact registration. */
  readerBackground?: { url: string; opacity: number; dim: number };
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

/**
 * Where an installed plugin's files came from. Only `marketplace` plugins
 * update from the marketplace without asking; a `local` folder or zip is never
 * replaced by a listing that happens to share its id.
 */
export type PluginInstallSource = "marketplace" | "local";

/** An installed plugin as shown in settings; `error` records a failed activation. */
export type InstalledPlugin = {
  manifest: PluginManifest;
  enabled: boolean;
  /** User-selected object grant; absent only for legacy installs. */
  bookAccess?: PluginBookAccess;
  /** Lets settings disclose that `bookAccess` was derived from old domain consent. */
  bookAccessSource?: "legacy-domain" | "user";
  /** Shipped in the app bundle: default-enabled, not uninstallable. */
  builtin?: boolean;
  /** Absent for built-ins and for installs that predate provenance tracking. */
  installSource?: PluginInstallSource;
  /** Why the plugin is not running (failed activation or a fatal runtime error).
   *  Settings render it through `describeError`; its message is log-only. */
  error?: Error;
};
