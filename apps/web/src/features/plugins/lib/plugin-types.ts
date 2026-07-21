/**
 * The plugin API surface — every type a plugin author touches.
 *
 * Design contract (docs/plugin-system.md): plugins contribute *declarative*
 * capabilities (actions, commands, agent tools) and describe any UI they open
 * with the constrained view vocabulary below (markdown / list / form). They
 * never render JSX or HTML; the app renders every view with its own design
 * system, so plugin surfaces always look native.
 */

/** Permission domains a manifest may declare (docs/plugin-system.md §4). */
export const PLUGIN_PERMISSIONS = ["reading-data", "network", "ai", "clipboard"] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export type PluginManifest = {
  /** Directory name and namespace: lowercase, digits, hyphens. */
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  /** Lowest app version the plugin supports, e.g. "0.2.0". */
  minAppVersion?: string;
  permissions?: PluginPermission[];
  /** Entry module relative to the plugin folder. Defaults to "main.js". */
  main?: string;
};

/** Returned by every `register*` call; disposing removes the contribution. */
export type PluginDisposable = { dispose: () => void };

// ─── View vocabulary ─────────────────────────────────────────────────────────

export type PluginMarkdownView = {
  kind: "markdown";
  title?: string;
  markdown: string;
};

export type PluginListItem = {
  id: string;
  title: string;
  subtitle?: string;
  /** Icon name from the curated Phosphor set (see plugin-icons.ts). */
  icon?: string;
  /** Optional drill-down: return `{ view }` to push a detail view. */
  onSelect?: () => PluginViewResult | Promise<PluginViewResult>;
};

export type PluginListView = {
  kind: "list";
  title?: string;
  items: PluginListItem[];
  /** Shown when `items` is empty. */
  emptyText?: string;
};

export type PluginFormField =
  | { kind: "text"; id: string; label: string; value?: string; placeholder?: string }
  | {
      kind: "select";
      id: string;
      label: string;
      value?: string;
      options: { value: string; label: string }[];
    }
  | { kind: "toggle"; id: string; label: string; value?: boolean };

export type PluginFormValues = Record<string, string | boolean>;

export type PluginFormView = {
  kind: "form";
  title?: string;
  fields: PluginFormField[];
  submitLabel?: string;
  onSubmit: (values: PluginFormValues) => PluginViewResult | Promise<PluginViewResult>;
};

export type PluginView = PluginMarkdownView | PluginListView | PluginFormView;

/**
 * What an action / list-select / form-submit may produce:
 * - `undefined` / `null` — nothing happens (surface stays as is);
 * - `{ toast }` — a transient notice;
 * - `{ view }` — open (or push onto) the surface with this view;
 * - `{ close: true }` — dismiss the surface (composable with `toast`).
 */
export type PluginViewResult =
  | void
  | undefined
  | null
  | { toast?: string; view?: PluginView; close?: boolean };

// ─── Contributions ───────────────────────────────────────────────────────────

/** Where a selection action was triggered from. */
export type SelectionActionSource = "selection" | "annotation" | "navigator";

export type SelectionActionInput = {
  text: string;
  /** CFI range of the selection/annotation, when the engine can anchor it. */
  cfiRange: string | null;
  chapterHref: string | null;
  book: { id: string; title: string; author?: string };
  source: SelectionActionSource;
};

/**
 * An entry in the reader's selection/annotation action menus. Runs silently
 * (`toast` feedback) or opens a Dialog (`view` result) — the only two outcomes
 * allowed inside the reader.
 */
export type PluginSelectionAction = {
  id: string;
  title: string;
  icon?: string;
  run: (input: SelectionActionInput) => PluginViewResult | Promise<PluginViewResult>;
};

export type PluginHeaderSurface = "shelf" | "reader";

export type HeaderActionInput = {
  /** Present on the reader surface: the open book. */
  book?: { id: string; title: string; author?: string };
};

/**
 * An icon button on a header bar. On the reader surface the view always opens
 * as an anchored Popup; on the shelf it opens as a Popup or a full Page,
 * per `presentation`.
 */
export type PluginHeaderAction = {
  id: string;
  title: string;
  icon?: string;
  surface: PluginHeaderSurface;
  /** Shelf only — the reader never allows full-page interruptions. */
  presentation?: "popup" | "page";
  view: (input: HeaderActionInput) => PluginView | Promise<PluginView>;
};

/** A command-palette entry. */
export type PluginCommand = {
  id: string;
  title: string;
  icon?: string;
  /** Extra text folded into palette matching. */
  keywords?: string;
  run: () => PluginViewResult | Promise<PluginViewResult>;
};

/**
 * A tool exposed to the reading agent. `parameters` is plain JSON Schema for
 * the arguments object; omit it for a no-argument tool. The registered tool is
 * namespaced `plugin_<pluginId>_<name>` before it reaches the model.
 */
export type PluginToolDefinition = {
  /** snake_case identifier, unique within the plugin. */
  name: string;
  /** Short human label shown in the chat's tool activity row. */
  label?: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => unknown | Promise<unknown>;
};

// ─── Context handed to activate() ────────────────────────────────────────────

export type PluginStorage = {
  get<T = unknown>(key: string): T | null;
  set(key: string, value: unknown): void;
  remove(key: string): void;
};

export type PluginBookOverview = {
  id: string;
  title: string;
  author?: string;
  progressFraction?: number;
  addedAt?: string;
  lastOpenedAt?: string;
};

export type PluginAnnotation = {
  id: string;
  bookId: string;
  kind: "highlight" | "note" | "ask";
  text: string;
  content?: string;
  chapter?: string;
  createdAt: string;
};

/**
 * Everything a plugin can reach. Capability groups guarded by a permission
 * domain are absent unless the manifest declares that permission — API-level
 * gating against accidental overreach (the trust boundary is installation,
 * see docs/plugin-system.md §2).
 */
export type PluginContext = {
  readonly manifest: Readonly<PluginManifest>;
  readonly appVersion: string;
  /** Namespaced key-value storage, persisted with the app's local data. */
  storage: PluginStorage;
  ui: {
    registerSelectionAction(action: PluginSelectionAction): PluginDisposable;
    registerHeaderAction(action: PluginHeaderAction): PluginDisposable;
    registerCommand(command: PluginCommand): PluginDisposable;
    showToast(message: string): void;
  };
  /** Requires the `ai` permission. */
  ai?: {
    registerTool(tool: PluginToolDefinition): PluginDisposable;
  };
  /** Requires the `network` permission. */
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  /** Requires the `reading-data` permission (read-only). */
  reading?: {
    listBooks(): Promise<PluginBookOverview[]>;
    listAnnotations(filter?: { bookId?: string }): Promise<PluginAnnotation[]>;
  };
  /** Requires the `clipboard` permission. */
  clipboard?: {
    writeText(text: string): Promise<void>;
  };
};

/** The default export of a plugin's entry module. */
export type PluginModule = {
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
};

// ─── Registered (app-side) shapes ────────────────────────────────────────────

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
