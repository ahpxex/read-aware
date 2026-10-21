/**
 * @read-aware/plugin-types — the public plugin API contract.
 *
 * This package is the single source of truth for every type a plugin author
 * touches (docs/plugins/plugin-system.md). The app re-exports it (its surfaces build
 * on these shapes), and the marketplace repo's TypeScript template ships a
 * declaration copy of it so plugins get full typing with zero dependencies.
 *
 * ## Construction rules (docs/plugins/plugin-system.md §4–§6)
 *
 * The contract is DERIVED from the app's domain model, not authored beside it:
 *
 * 1. **Data surface per domain.** Library, reading, annotations,
 *    conversations, and settings each expose the parts their domain owns:
 *    *queries* mirroring projection read models, *commands* mirroring exactly
 *    its domain-event verbs (commands issued through the same event-sourced
 *    write path the app itself uses), and *events* under their canonical
 *    names — one vocabulary, no parallel rename.
 * 2. **Permission = domain × access.** `library:read`, `annotations:write`, …
 *    Write implies read within a domain. Services (`service:*`) and the agent
 *    tool mount (`agent:tools`) are separate permission families.
 * 3. **Origin on every write.** Plugin writes are stamped
 *    `plugin:<id>` in the event log — auditable, compensatable.
 * 4. **Device-local state and presentation stay host-owned.** View preferences,
 *    reader appearance, layouts, sync internals are not plugin surface; UI is
 *    declared as a host component tree (markdown / list / form / detail /
 *    compositional blocks) and rendered by the app's design system. Layout is
 *    expressed through bounded Stack/Section/Columns semantics, never CSS.
 *    Plugins never render JSX or HTML, and declarations are validated again
 *    at runtime before React sees them. Reader-mode plugins supply plain-text
 *    offset segmentation only; DOM, engine objects, input, and controls stay
 *    inside the host.
 *
 *    The one deliberate opening in this rule is themes (`ui:themes`): a plugin
 *    may DECLARE appearance data — named palettes over the host's fixed token
 *    vocabulary, plus bundled font faces — in its manifest. The data is
 *    validated against strict color/path grammars, the CSS is generated and
 *    injected by the host, and nothing applies until the user selects the
 *    theme in Settings. Plugins still never hand the host a stylesheet.
 */

import { PLUGIN_PERMISSIONS as CORE_PLUGIN_PERMISSIONS } from "@read-aware/core";
export type {
  BookRemovalReceipt,
  BookFileReleaseReceipt,
  BookRemovalCleanupPage,
  BookRemovalCleanupQuery,
} from "@read-aware/core";
export type {
  ReadingTimeQuery,
  ReadingTimeCursor,
  ReadingTimeSnapshot,
  ReadingTimeObservation,
  PendingReadingTime,
} from "@read-aware/core";
export type { ReadingInsights, ReadingInsightsQuery, ReadingPeriod } from "@read-aware/core";
export type {
  ReadingEmphasisWrite,
  ReadingEmphasisRef,
  ReadingEmphasisStyle,
  ReadingEmphasisSnapshot,
  ReadingEmphasisReceipt,
  ReadingEmphasisRemoval,
} from "@read-aware/core";
export type {
  WorkspaceTarget,
  WorkspaceQuery,
  WorkspaceSnapshot,
  WorkspaceReceipt,
  WorkspaceSettingsSection,
} from "@read-aware/core";
export type { SettingsObservation, SettingsObservationCause } from "@read-aware/core";
export type {
  MemoryRecord,
  MemoryScope,
  MemoryQuery,
  BookGraphQuery,
  BookGraphResult,
  BookGraphProfile,
} from "@read-aware/core";
export type { MemoryPage, MemoryPageQuery } from "@read-aware/core";
export type { MemorySnapshot, MemoryMutation, MemoryMutationReceipt } from "@read-aware/core";
export type { BookClassificationSnapshot, BookClassificationChange, BookClassificationReceipt } from "@read-aware/core";
export type { MemoryObservationQuery, MemoryObservationResult, MemoryObservation } from "@read-aware/core";
export type {
  ContextBundle,
  ContextBundleContent,
  ContextBundleItem,
  ContextBundleOmission,
  ContextBundleKind,
  ContextBundleScope,
  ContextBundleSelector,
  ContextBundleHistoryQuery,
  ContextBundleHistoryPage,
  ContextBundleHistoryEntry,
  ContextBundleReadQuery,
  ContextBundleCaptureReceipt,
} from "@read-aware/core";
export type {
  HostCommandId,
  HostCommandRequest,
  HostCommandDescriptor,
  HostCommandSnapshot,
  HostCommandReceipt,
  HostCommandObservation,
} from "@read-aware/core";
import type {
  AnnotationItem,
  AskItem,
  BookFormat,
  BookSummary,
  ChapterRef,
  ChatMessageSummary,
  CollectionSummary,
  DictionaryEntrySnapshot,
  DomainEvent,
  DomainAccess,
  DomainEventType,
  DomainId,
  DomainPermission,
  DeclarativeSchemaId,
  ContributionId,
  HostServiceId,
  PluginPermission as CorePluginPermission,
  EventOrigin,
  HighlightColor,
  HighlightItem,
  HighlightStyle,
  HlcStamp,
  SealedEventWire,
  BookStats,
  NoteItem,
  ReadingStatus,
  SettingCatalogEntry,
  SettingChange,
  SettingReadResult,
  SettingsAccessPolicy,
  SettingsChangedEvent,
  SettingsQuery,
  SettingsQueryTarget,
  SettingsUpdateResult,
  StatsOverview,
  ThreadSummary,
} from "@read-aware/core";

// Re-exported so plugin authors can name the underlying vocabulary without
// depending on @read-aware/core directly.
export type { BookTextSearch, BookTextHit } from "@read-aware/core";
export type { BookImportPhase, BookImportReceipt, BookImportRequest, BookImportTaskSnapshot } from "@read-aware/core";
export type {
  BookTextRange,
  BookRangeQuery,
  BookRangePage,
  BookTextSnapshot,
  BookTextTaskSnapshot,
  BookTextPrepareOptions,
  BookTextTaskHistoryEntry,
  BookTextTaskHistoryPage,
  BookTextTaskHistoryQuery,
  BookTextPriority,
  BookTextWaitReason,
  AnnotationSnapshot,
  AnnotationMutation,
  AnnotationCommitResult,
  AnnotationPage,
  AnnotationPageQuery,
  BookTocEntry,
  BookNavigationToc,
  BookLocationSearch,
  BookLocationSearchPage,
  BookLocationHit,
  ReadingLocation,
  ReadingTarget,
  ReadingSessionSnapshot,
  ReadingSessionChange,
  ReadingPaginationSnapshot,
  ReadingSelectionSnapshot,
  ReadingSelectionReceipt,
  ReadingSessionGuard,
  ReadingNavigationReceipt,
  ReadingPlaybackSnapshot,
  ReadingPlaybackReceipt,
  ReadingModeConfiguration,
  ReadingModeDescriptor,
  ReadingModeSnapshot,
  ReadingModeReceipt,
  ReadingModePosition,
  ReadingModeStepOutcome,
  ReadingModeStepReceipt,
} from "@read-aware/core";
export type {
  BookFormat,
  DictionaryEntrySnapshot,
  DomainAccess,
  DomainEventType,
  DomainId,
  DomainPermission,
  DeclarativeSchemaId,
  ContributionId,
  HostServiceId,
  EventOrigin,
  HighlightColor,
  HighlightStyle,
  HlcStamp,
  SealedEventWire,
  ReadingStatus,
  SettingCatalogEntry,
  SettingChange,
  SettingReadResult,
  SettingsAccessPolicy,
  SettingsChangedEvent,
  SettingsQuery,
  SettingsQueryTarget,
  SettingsUpdateResult,
};

// ─── Permissions ─────────────────────────────────────────────────────────────

/**
 * Permission domains a manifest may declare (docs/plugins/plugin-system.md §4).
 *
 * - `<domain>:read` / `<domain>:write` — data access per domain; write
 *   implies the domain's read surface. Library ownership and reading-state
 *   ownership are separate domains.
 * - `reader:modes` — privileged host-rendered reader-mode registration.
 * - `ui:themes` — declare app/reader themes and bundled fonts in the
 *   manifest. The only UI contribution that needs a permission: unlike
 *   actions and commands it has visual authority over the whole app, so the
 *   install consent must surface it.
 * - Settings access is declared separately by exact path in `settingsAccess`.
 * - `agent:tools` — register tools on the reading agent.
 * - `agent:context`, `agent:retrieval`, `agent:memory` — contribute bounded
 *   reference data, searchable sources, or host-reviewed memory candidates.
 * - `sync:transport` — provide a sync backend (a remote mailbox the host's
 *   sync engine pushes to and pulls from). The plugin only ever moves
 *   ciphertext: encryption, the event log, and merge stay host-owned.
 * - `service:*` — platform and AI services (network, one-shot LLM,
 *   clipboard).
 *
 * Namespaced storage, UI contributions, session events, and ambient reader
 * control are not permissions — every plugin has them.
 */
export type PluginPermission = CorePluginPermission;

/** Runtime validation list, derived from the canonical capability catalogs. */
export const PLUGIN_PERMISSIONS = CORE_PLUGIN_PERMISSIONS;

export type PluginCapabilityRequirements = {
  domains?: Partial<Record<DomainId, string>>;
  contributions?: Partial<Record<ContributionId, string>>;
  services?: Partial<Record<HostServiceId, string>>;
  schemas?: Partial<Record<DeclarativeSchemaId, string>>;
};

export type PluginCapabilityView = {
  domains: Partial<Record<DomainId, string>>;
  contributions: Partial<Record<ContributionId, string>>;
  services: Partial<Record<HostServiceId, string>>;
  schemas: Partial<Record<DeclarativeSchemaId, string>>;
};

/**
 * User granted book scope for a plugin activation. `all` is the legacy
 * domain-level grant; `current` follows the book and session currently held
 * by the reader; `book` names one stable library object.
 *
 * This is host authority, not a manifest declaration. A plugin cannot widen
 * it by passing a different book id, range, cursor, resource id, or observer
 * query.
 */
export type PluginBookAccess = { mode: "all" } | { mode: "current" } | { mode: "book"; bookId: string };

// ─── Manifest ────────────────────────────────────────────────────────────────

export type PluginNetworkAccess = {
  /** Exact HTTP(S) origins (scheme/host/port), or ["*"] for all HTTP(S) origins.
   * No paths, subdomain globs, credentials or fragments. At most 32 entries. */
  origins: string[];
};

export type PluginNetworkStream = {
  /** Opaque, non-persistent response owned by this activation only. */
  id: string;
  status: number;
  statusText: string;
  url: string;
  redirected: boolean;
  headers: [string, string][];
  /** Absolute deadline for headers and all subsequent reads, not refreshed by activity. */
  expiresAt: number;
};

export type PluginNetworkChunk = {
  offset: number;
  bytes: ArrayBuffer;
  /** EOF releases the response. The final non-empty chunk may precede an empty EOF read. */
  done: boolean;
};

export type PluginManifest = {
  /** Directory name and namespace: lowercase, digits, hyphens. */
  id: string;
  name: string;
  version: string;
  /**
   * Version of this plugin's private KV and document data. The host records
   * the last committed value separately from plugin-owned storage and invokes
   * migrate() before a different version becomes active.
   */
  schemaVersion: number;
  description?: string;
  author?: string;
  /** Lowest app version the plugin supports, e.g. "0.3.0". */
  minAppVersion?: string;
  /** Exact host capability contracts and semver ranges this plugin needs. */
  requires: PluginCapabilityRequirements;
  permissions?: PluginPermission[];
  /** Exact Settings Domain paths, or an explicit `section.*` group. */
  settingsAccess?: SettingsAccessPolicy;
  /** Network 2.0. Missing/empty means no arbitrary HTTP requests, even with
   * service:network. Fixed-purpose host actions retain their own authorization.
   * Disclosed on install/update; requires a network >=2 capability range. */
  networkAccess?: PluginNetworkAccess;
  /** Entry module relative to the plugin folder. Defaults to "main.js". */
  main?: string;
  /**
   * Declarative settings: rendered by the app from the Plugins panel; edits
   * write through as one object under the plugin's storage key `settings`
   * (read with `ctx.services.storage.get("settings")`).
   *
   * Nothing is stored until the first save, so `get("settings")` starts as
   * null; declared `value`s are only what the form shows. A save from the
   * settings page writes every non-secret field; the agent and the settings
   * domain merge one field at a time (null resets it). Merge your defaults
   * over whatever is stored.
   */
  settings?: PluginFormField[];
  /**
   * Declarative schedules (shown at install and in the Plugins panel). The
   * host runs each one AT LEAST every `everyMinutes` while the app is open,
   * with a catch-up run at launch when overdue — never an exact-time
   * guarantee, and nothing runs while the app is closed. The plugin binds
   * the actual work at activate() via `ctx.services.schedules.bind(id, run)`.
   */
  schedules?: PluginScheduleDeclaration[];
  /** Plugins 1.8: explicit versioned module service exports, executed with shared authority. */
  services?: import("@read-aware/core").PluginServiceDeclaration[];
  /**
   * Declarative themes (`ui:themes`). Registered while the plugin is enabled;
   * they appear alongside the built-in choices in Settings → Appearance
   * (app part) and the reader's page-color control (reader part), and apply
   * only when the user selects them. Purely data — the host generates and
   * injects all CSS.
   */
  themes?: PluginThemeContribution[];
  /**
   * Font faces bundled with the plugin (`ui:themes`), served from the plugin
   * folder. Each becomes a `plugin:<pluginId>:<fontId>` entry in the reader's
   * font picker; a theme's typography defaults may reference its own fonts
   * as `plugin:<fontId>`.
   */
  fonts?: PluginFontContribution[];
};

// ─── Voice providers (read-aloud) ────────────────────────────────────────────

/** One selectable voice a provider offers. */
export type PluginVoice = {
  /** Unique within the provider. */
  id: string;
  label: PluginText;
  /** BCP-47 tags this voice speaks well — informational, shown in pickers. */
  languages?: string[];
};

/**
 * A text-to-speech engine for the reader's read-aloud. The plugin only turns
 * text into ENCODED AUDIO BYTES (mp3/wav/ogg — anything the webview can
 * decode); the host owns playback, sentence pacing, prefetch, and the
 * follow-along highlight, and falls back to the system voice when a call
 * fails. Voices are listed once at registration and re-listed when the
 * plugin's settings change.
 */
export type PluginVoiceProvider = {
  id: string;
  /** Provider name shown alongside its voices in the voice picker. */
  label: PluginText;
  listVoices(): PluginVoice[] | Promise<PluginVoice[]>;
  synthesize(input: { text: string; voiceId: string }): Promise<ArrayBuffer | Uint8Array>;
};

// ─── Schedule declarations ───────────────────────────────────────────────────

/** The floor the host clamps `everyMinutes` to. */
export const MIN_SCHEDULE_MINUTES = 15;

export type PluginScheduleDeclaration = {
  /** Unique within the plugin: lowercase letters, digits, hyphens. */
  id: string;
  /** Shown at install time and in the Plugins panel. */
  label: string;
} & ({ everyMinutes: number; mode?: never } | { mode: "deferred"; everyMinutes?: never });

// ─── Theme contributions (`ui:themes`) ───────────────────────────────────────

/**
 * Whether a theme reads as light or dark. Drives everything polarity-keyed in
 * the host: `color-scheme`, the dark token defaults an app theme inherits for
 * tokens it leaves unset, the `dark:` styling variant, and how the reader's
 * "auto" page color resolves while the theme is active.
 */
export type PluginThemePolarity = "light" | "dark";

/**
 * A color in one of the strict grammars the host accepts: `#rgb[a]` /
 * `#rrggbb[aa]` hex, or `rgb()` / `rgba()` / `hsl()` / `hsla()` with numeric
 * bodies only. Anything else — keywords, `var()`, `url()`, gradients — is
 * rejected at manifest validation. The grammar is the injection boundary:
 * these values end up inside host-generated stylesheets.
 */
export type PluginThemeColor = string;

/**
 * The app-chrome token vocabulary a theme may override. Every key is optional:
 * unset tokens keep the host's own values for the theme's polarity, so a
 * near-default theme only states its differences. This vocabulary is a
 * long-term contract (only ever extended, never renamed).
 */
export type PluginAppThemeTokens = {
  /** The app canvas. */
  paper?: PluginThemeColor;
  /** Hairline borders. */
  border?: PluginThemeColor;
  /** Primary text. */
  fg?: PluginThemeColor;
  /** Secondary text. */
  fgMuted?: PluginThemeColor;
  /** Tertiary/disabled text. */
  fgSubtle?: PluginThemeColor;
  /** Text on inverted (fg-colored) surfaces. */
  inverseFg?: PluginThemeColor;
  /** Raised surfaces: cards, dialogs, inputs. */
  surface?: PluginThemeColor;
  /** Quiet fills: hovers, wells, code spans. */
  fill?: PluginThemeColor;
  /** Stronger fills: active states, tracks. */
  fillStrong?: PluginThemeColor;
  /** Emphasized borders. */
  borderStrong?: PluginThemeColor;
  /** The main content surface behind panels. */
  mainSurface?: PluginThemeColor;
  /** Overlay scrollbar thumbs. */
  scrollbar?: PluginThemeColor;
};

/**
 * The six-color palette a reader theme paints book pages with — the same
 * vocabulary the built-in light/warm/dark page colors use. All six are
 * required: book pages have no polarity fallback to inherit from.
 */
export type PluginReaderPalette = {
  /** Page background. */
  bg: PluginThemeColor;
  /** Body text. */
  text: PluginThemeColor;
  /** Text selection background. */
  selection: PluginThemeColor;
  /** Rules and table borders. */
  rule: PluginThemeColor;
  /** Quiet fills (code blocks, inline code). */
  faint: PluginThemeColor;
  /** De-emphasized ink: link underlines, list markers, captions. */
  muted: PluginThemeColor;
};

export type PluginReaderFontSize =
  | "xx-small"
  | "x-small"
  | "small"
  | "medium"
  | "large"
  | "x-large"
  | "xx-large"
  | "xxx-large";
export type PluginReaderFontWeight = "light" | "regular" | "medium" | "semibold" | "bold" | "extra-bold" | "black";
export type PluginReaderLineSpacing = "compact" | "comfortable" | "relaxed";
export type PluginReaderParagraphSpacing = "tight" | "normal" | "loose";

/**
 * Typography a reader theme suggests. Applied as a one-shot preset when the
 * user SELECTS the theme — seeding the ordinary reader settings, which the
 * user can then adjust freely (re-selecting the theme re-applies). Never a
 * live constraint.
 *
 * `fontFamily` accepts `plugin:<fontId>` (a font this manifest declares),
 * `curated:<id>` (a host curated font), or `system:<family>`.
 */
export type PluginReaderTypographyDefaults = {
  fontFamily?: string;
  fontSize?: PluginReaderFontSize;
  fontWeight?: PluginReaderFontWeight;
  lineSpacing?: PluginReaderLineSpacing;
  paragraphSpacing?: PluginReaderParagraphSpacing;
};

/**
 * One named theme. The two mount points are independent and optional — a
 * theme may skin only the app chrome, only the book page, or both; each part
 * is offered only on the surface it targets.
 */
export type PluginThemeContribution = {
  /** Theme id within the plugin: lowercase, digits, hyphens. */
  id: string;
  /** Display name in the theme pickers. */
  name: PluginText;
  polarity: PluginThemePolarity;
  /** App-chrome token overrides (Settings → Appearance). */
  app?: PluginAppThemeTokens;
  /** Book-page palette and optional typography preset (reader page color). */
  reader?: {
    palette: PluginReaderPalette;
    typography?: PluginReaderTypographyDefaults;
  };
};

/**
 * One font face file inside the plugin folder. `path` is folder-relative
 * (forward slashes, `[A-Za-z0-9._-]` segments, no leading dots) and must end
 * in `.woff2`, `.woff`, `.ttf`, or `.otf`.
 */
export type PluginFontFile = {
  path: string;
  /** CSS numeric weight of this face. Defaults to 400. */
  weight?: number;
  /** Defaults to "normal". */
  style?: "normal" | "italic";
  /** Optional `unicode-range` for split/subset files. */
  unicodeRange?: string;
};

/**
 * A font bundled with the plugin. Its faces are served straight from the
 * plugin folder (no download step); the host writes the `@font-face` rules
 * and lists the family in the reader's font picker while the plugin is
 * enabled.
 */
export type PluginFontContribution = {
  /** Font id within the plugin: lowercase, digits, hyphens. */
  id: string;
  /** CSS font-family name; also the picker label. */
  family: string;
  /** Chooses the generic fallback stack appended after the family. */
  kind?: "sans" | "serif" | "cjk";
  files: PluginFontFile[];
};

/** Returned by every `register*`/`on` call; disposing removes the contribution. */
export type PluginDisposable = { dispose: () => void };
/** A contribution handle bound to a live event delivery. Await retirement to
 * observe host rejection or registration retirement across the Worker boundary;
 * already-started provider cleanup still follows the activation drain contract. */
export type PluginEventRegistration<T extends PluginDisposable> = Omit<T, "dispose"> & { dispose(): Promise<void> };

// ─── View vocabulary ─────────────────────────────────────────────────────────

export type PluginMarkdownView = {
  kind: "markdown";
  title?: string;
  markdown: string;
};

/** An app-rendered action. Plugins provide behavior and content, never UI. */
export type PluginAction = {
  id: string;
  label: string;
  /** Icon name from the curated Phosphor set. */
  icon?: string;
  variant?: "solid" | "outline" | "ghost" | "danger";
  /**
   * Where a view-level toolbar places the action. `primary` actions render
   * inline as labeled buttons; `secondary` ones fold into the host's "More"
   * menu. Unset actions fill the remaining inline slots in declaration order
   * (a `solid` action counts as primary), so a view should mark at most two
   * actions primary and leave housekeeping such as refresh secondary.
   */
  priority?: "primary" | "secondary";
  /**
   * Views 1.12: render the action inert. For a control whose availability the
   * plugin knows when it builds the view (history that cannot go back yet), so
   * the row keeps its shape instead of the control appearing and vanishing.
   */
  disabled?: boolean;
  run: () => PluginViewResult | Promise<PluginViewResult>;
};

export type PluginListAccessory =
  | { kind: "text"; text: string }
  | { kind: "tag"; text: string }
  | { kind: "icon"; icon: string; label?: string };

export type PluginListItem = {
  id: string;
  title: string;
  subtitle?: string;
  /** ISO timestamp used by the host timeline, never formatted by the plugin. */
  timestamp?: string;
  /** Icon name from the curated Phosphor set. */
  icon?: string;
  /** Additional terms used by the host's built-in filtering. */
  keywords?: string[];
  /** Quiet, host-rendered values at the trailing edge of the item. */
  accessories?: PluginListAccessory[];
  /** Open returned views in-place or in a host-owned modal Dialog. */
  presentation?: "push" | "dialog";
  /** Optional drill-down: return `{ view }` for the selected item. */
  onSelect?: () => PluginViewResult | Promise<PluginViewResult>;
};

/** Plugin-owned pages, including cursor sources with no known page count.
 * Callbacks return the complete containing view; navigation defaults to replace.
 * No speculative fetch, accumulation, or data-source access is performed by the host. */
export type PluginViewPagination = {
  /** One-based display page. */
  page: number;
  pageCount?: number;
  /** Omit a callback when that direction is unavailable. */
  onPrevious?: () => PluginViewResult | Promise<PluginViewResult>;
  onNext?: () => PluginViewResult | Promise<PluginViewResult>;
};

/**
 * Views 1.12: a search box whose results the PLUGIN computes — for lists
 * where matching is not a substring test over the supplied rows: a go-to box
 * that reads "42" as chapter 42 and page 42, or a query that reaches data
 * outside the current page. The host owns the input: it renders the field,
 * debounces typing, keeps the typed text across pushed views and back
 * navigation, and drops out-of-order answers, so the plugin only maps a query
 * to rows. Enter activates the first row that has `onSelect`.
 */
export type PluginListSearch = {
  placeholder?: string;
  /** Focus the field when the list mounts; for panels whose whole purpose is the box. */
  autoFocus?: boolean;
  /**
   * Called with the trimmed text after typing settles (and with "" when the
   * box is cleared). Return `{ view }` with the complete list for that text:
   * it replaces this frame's CONTENT in place — the same lifecycle as a live
   * update, so the field keeps its text, focus and caret — rather than
   * navigating, and must therefore carry no `live` or `onClose`. Return null
   * to keep what is shown. Other result fields (close, toast, navigation,
   * fieldErrors) are rejected: a query is a read, not an action.
   */
  onQuery: (query: string) => PluginViewResult | Promise<PluginViewResult>;
};

export type PluginListView = {
  kind: "list";
  title?: string;
  items: PluginListItem[];
  /** Host-rendered list-level actions; timelines place them after the tabs. */
  actions?: PluginAction[];
  /** Shown when `items` is empty. */
  emptyText?: string;
  /** Adds host-rendered local filtering over title, subtitle, and keywords. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Plugin-computed search (views 1.12). Exclusive with `searchable`. */
  search?: PluginListSearch;
  /**
   * Sort and group items by `timestamp`, with host-owned Today / This week /
   * This month / All tabs. Search is debounced by the host.
   */
  timeline?: boolean;
  /** Search and timeline filters apply only to items on this supplied page. */
  pagination?: PluginViewPagination;
};

export type PluginTableColumn = {
  id: string;
  label: string;
  align?: "start" | "end";
  /** Requires the table's sort controller. */
  sortable?: boolean;
};
export type PluginTableSort = { column: string; direction: "ascending" | "descending" };
export type PluginTableRow = {
  id: string;
  /** Accessible name for the row's open command. */
  label: string;
  /** Exactly one plain-text, finite-number, or null cell for each declared column. */
  cells: Record<string, string | number | null>;
  presentation?: "push" | "dialog";
  onSelect?: () => PluginViewResult | Promise<PluginViewResult>;
};
/** A semantic, horizontally scrollable table: 1-16 columns and at most 200 rows
 * per snapshot. Use pagination for larger datasets. No HTML or custom cell renderers. */
export type PluginTableView = {
  kind: "table";
  title?: string;
  columns: PluginTableColumn[];
  rows: PluginTableRow[];
  actions?: PluginAction[];
  emptyText?: string;
  pagination?: PluginViewPagination;
  /** Plugin owns dataset-wide ordering and returns the complete containing view.
   * The host never sorts only the visible page. Navigation defaults to replace. */
  sort?: {
    value?: PluginTableSort;
    onChange: (sort: PluginTableSort) => PluginViewResult | Promise<PluginViewResult>;
  };
};

export type PluginTreeNode = {
  /** Unique throughout this tree snapshot, not just among siblings. */
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  /** Supplied children only. Expanding never fetches data or invokes plugin code. */
  children?: PluginTreeNode[];
  presentation?: "push" | "dialog";
  onSelect?: () => PluginViewResult | Promise<PluginViewResult>;
};
/** Bounded hierarchy: at most 500 nodes including collapsed descendants, 12
 * levels. Expansion and keyboard focus belong to the mounted host frame.
 * Use pagination/actions to load another complete snapshot, not hidden IO. */
export type PluginTreeView = {
  kind: "tree";
  /** Required accessible name, also used as the root view heading. */
  title: string;
  nodes: PluginTreeNode[];
  /** Initial expansion for each mounted frame; must name populated branches.
   * Live updates retain local expansion for surviving IDs. */
  expandedIds?: string[];
  actions?: PluginAction[];
  emptyText?: string;
  pagination?: PluginViewPagination;
};

/** Host-decoded preview of this activation's sealed resource. No URL, path,
 * data URI, HTML or original book file. PNG/JPEG/GIF/BMP/WebP raster inputs;
 * preview is a static PNG, at most 2048 px per edge, without upscaling. */
export type PluginImageView = {
  kind: "image";
  resourceId: string;
  title?: string;
  /** Required alternative text; empty explicitly marks a decorative image. */
  alt: string;
  caption?: string;
  /** Stable display box ratio, 0.25..4, default 4/3; image always fits uncropped. */
  aspectRatio?: number;
};

/**
 * A bounded plain-text editor. The host owns the draft and its explicit
 * save/cancel controls; `revision` is an opaque value the consumer must pass
 * back to its conditional write. This is deliberately not rich text and does
 * not expose React, HTML, DOM, or storage access to a plugin.
 */
export type PluginEditorView = {
  kind: "editor";
  title?: string;
  label: PluginText;
  value: string;
  /** Non-empty opaque revision captured with `value`; never interpreted by the host. */
  revision: string;
  /** UTF-16 code-unit limit enforced by the host; at most 100,000. */
  maxLength: number;
  saveLabel?: PluginText;
  cancelLabel?: PluginText;
  /** Called only after an explicit save, with the captured revision. */
  onSave: (value: string, revision: string) => PluginViewResult | Promise<PluginViewResult>;
  /** Optional cancellation navigation. The host discards the draft first. */
  onCancel?: () => PluginViewResult | Promise<PluginViewResult>;
};

/**
 * Shared field attributes. `agentHidden` keeps a declared setting out of the
 * reading agent's settings catalog (the Plugins panel still shows it); text
 * fields with `inputMode: "password"` are agent-hidden automatically — and
 * real credentials belong in `ctx.services.secrets`, not in settings at all.
 *
 * `visibleWhen` renders the field only while another field of the same form
 * holds one of the given values (compared as strings). Hidden fields keep
 * their stored values — this is how one settings object carries a value set
 * per variant (e.g. one voice per TTS provider) without the variants
 * overwriting each other.
 *
 * Every user-visible string on a field (`label`, `helperText`,
 * `placeholder`, `description`, option labels) is a `PluginText`: a plain
 * string, or a localized bundle resolved against the app language.
 */
type PluginFormFieldBase = {
  agentHidden?: boolean;
  visibleWhen?: { field: string; equals: string | string[] };
};

/** One option of a select/choice field. */
export type PluginSelectOption = { value: string; label: PluginText };

export type PluginFormField = PluginFormFieldBase &
  (
    | {
        kind: "text";
        id: string;
        label: PluginText;
        value?: string;
        placeholder?: PluginText;
        helperText?: PluginText;
        inputMode?: "text" | "email" | "url" | "password";
      }
    | {
        kind: "textarea";
        id: string;
        label: PluginText;
        value?: string;
        placeholder?: PluginText;
        helperText?: PluginText;
        rows?: number;
      }
    | {
        /**
         * A time of day, rendered as two host-owned dropdowns (hours,
         * minutes) — never a text box: a typed time invites "7pm", locale
         * ambiguity, and half-finished states, none of which a plugin should
         * have to parse. The stored value is always 24-hour `HH:MM`.
         */
        kind: "time";
        id: string;
        label: PluginText;
        /** `HH:MM`, 24-hour. */
        value?: string;
        helperText?: PluginText;
        /** Minute granularity offered, 1–30. Defaults to 5. */
        minuteStep?: number;
      }
    | {
        kind: "number";
        id: string;
        label: PluginText;
        value?: number;
        helperText?: PluginText;
        /** Stored values are finite numbers within min/max on every write path
         * (the settings page enforces them in releases after 0.6.5; the agent always did). */
        min?: number;
        max?: number;
        /** Input increment only; stored values are not rounded to it. */
        step?: number;
      }
    | {
        kind: "select";
        id: string;
        label: PluginText;
        value?: string;
        /** Static options; may be empty when `dynamicOptions` is set. */
        options: PluginSelectOption[];
        helperText?: PluginText;
        /**
         * Options resolved at runtime instead of listed in the declaration —
         * for lists only the plugin can know (an account's voices, what a
         * local endpoint serves). Declared settings bind the source via
         * `ctx.contributions.settingsOptions.register`; a plugin-authored form view carries
         * it as `resolveOptions`. While the source yields options the field
         * renders as a select (the stored value is kept selectable even when
         * the list no longer contains it); when it errors or yields none, the
         * field falls back to a free text input — a listing failure must
         * never lock the user out of typing the value.
         */
        dynamicOptions?: boolean;
        /**
         * Whether the resolved list is a CATALOG — the default: a sample of an
         * open set, so "Enter manually…" and the empty-list text fallback stay
         * available — or the WHOLE set (`false`: every acceptable value is in
         * the list, so typing one is meaningless and the escape hatch is
         * dropped; an empty list then reads as "nothing to pick" rather than
         * as an invitation to type). Set it to `false` only when the value is
         * checked against a closed set the host owns — a theme, an installed
         * font — never for a remote catalog that may be incomplete or briefly
         * unreachable.
         */
        allowManualEntry?: boolean;
      }
    | {
        /**
         * A credential field: host-rendered password input whose value lives in
         * the ENCRYPTED secret store (`ctx.services.secrets`), never in the settings
         * object, the KV, or the agent's settings catalog. `id` IS the secret
         * key the plugin reads back (`ctx.services.secrets.get(id)`); lowercase letters,
         * digits, `_`/`-`. The field shows configured/empty state and a clear
         * affordance — it never echoes the stored value. Writes go through the
         * form's `secrets` adapter: declared settings get it from the host; a
         * plugin-authored form view may supply its own bound to `ctx.services.secrets`.
         * A secret persists as soon as its input blurs, regardless of the
         * form's `submitMode` — credentials never sit in form state waiting
         * for a submit.
         */
        kind: "secret";
        id: string;
        label: PluginText;
        placeholder?: PluginText;
        helperText?: PluginText;
      }
    | {
        kind: "toggle";
        id: string;
        label: PluginText;
        description?: PluginText;
        value?: boolean;
      }
    | {
        kind: "checkbox";
        id: string;
        label: PluginText;
        description?: PluginText;
        value?: boolean;
      }
    | {
        kind: "choice";
        id: string;
        label: PluginText;
        value?: string;
        options: { value: string; label: PluginText; icon?: string }[];
      }
  );

export type PluginFormValues = Record<string, string | boolean | number>;

/**
 * Ordinary field drafts survive push/back within one host view session.
 * Root/live refreshes adopt unchanged defaults and preserve edited values.
 * Nested form identity is its structural path; fields use id and kind.
 * Replace/reset, removal or session disposal discard drafts. Password inputs
 * clear when their frame hides; secret fields never enter PluginFormValues.
 * This is in-memory editor state, not storage or a successful save receipt.
 */
export type PluginFormView = {
  kind: "form";
  title?: string;
  fields: PluginFormField[];
  /**
   * `explicit` (default) renders a submit button. `change` writes through after
   * each edit and omits that button, for forms that represent settings.
   */
  submitMode?: "explicit" | "change";
  submitLabel?: string;
  onSubmit: (values: PluginFormValues) => PluginViewResult | Promise<PluginViewResult>;
  /**
   * Option source for this form's `dynamicOptions` select fields. Called with
   * the field's id and the form's CURRENT values (so a list may depend on a
   * sibling field, e.g. an endpoint URL) when the field becomes visible and
   * again when sibling values change. Declared settings forms get this wired
   * by the host from `ctx.contributions.settingsOptions.register`.
   */
  resolveOptions?: (fieldId: string, values: PluginFormValues) => PluginSelectOption[] | Promise<PluginSelectOption[]>;
  /**
   * Storage adapter for this form's `secret` fields, keyed by field id.
   * Declared settings forms get one from the host, bound to the plugin's
   * encrypted secret namespace; a plugin-authored form may wire its own from
   * `ctx.services.secrets`. Secret fields render disabled without an adapter.
   */
  secrets?: {
    has(id: string): boolean | Promise<boolean>;
    set(id: string, value: string): void | Promise<void>;
    remove(id: string): void | Promise<void>;
  };
};

/**
 * The compositional view: an ordered sequence of blocks. This is the growth
 * path of the vocabulary — richer surfaces come from new block kinds, not
 * from plugins drawing their own UI. The single-kind views above remain as
 * shorthands for one-block pages.
 */
export type PluginBlocksView = {
  kind: "blocks";
  title?: string;
  blocks: PluginBlock[];
};

/**
 * A compact host-rendered control for a detail surface. Plugins declare the
 * options and behavior; the app owns the actual menu, focus behavior, and
 * visual treatment.
 */
export type PluginSelectControl = {
  kind: "select";
  id: string;
  label: string;
  value: string;
  icon?: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => PluginViewResult | Promise<PluginViewResult>;
};

export type PluginDetailControl = PluginSelectControl;

/** Host detail: primary content, contextual controls, actions, and metadata. */
export type PluginDetailView = {
  kind: "detail";
  title?: string;
  content: PluginBlock[];
  metadata?: PluginMetadataItem[];
  controls?: PluginDetailControl[];
  actions?: PluginAction[];
};

export type PluginMetadataItem =
  | { kind: "label"; label: string; value: string; icon?: string }
  | { kind: "tags"; label: string; values: string[] }
  | { kind: "divider" };

export type PluginLayoutGap = "tight" | "normal" | "relaxed";

export type PluginBlock =
  /** Host-localized persistent failure. Raw error text is never rendered. Views >=1.2. */
  | { kind: "error"; code: string }
  | { kind: "markdown"; markdown: string }
  /** Host typography; plugins choose semantic emphasis, never classes. */
  | {
      kind: "text";
      text: string;
      variant?: "body" | "caption" | "eyebrow" | "heading";
      tone?: "default" | "muted" | "subtle";
    }
  /** A section header: quiet eyebrow caption over an optional line of text. */
  | { kind: "heading"; text: string; caption?: string }
  /** A dictionary entry, rendered with the app's own dictionary UX. */
  | { kind: "dictionary"; entry: PluginDictionaryEntry }
  /** Label/value rows (provenance, metadata) in a quiet definition list. */
  | {
      kind: "keyValue";
      rows: { label: string; value: string }[];
      layout?: "stacked" | "inline";
      columns?: 1 | 2 | 3;
    }
  /** A quoted passage with an optional attribution line. */
  | { kind: "quote"; text: string; caption?: string }
  /** A row of host buttons; each runs like any other contribution outcome. */
  | { kind: "actions"; actions: PluginAction[]; align?: "start" | "end" }
  | { kind: "metric"; label: string; value: string; description?: string }
  /** Views 1.8: null is indeterminate. Cancel requests run while the main action is busy;
   * the plugin must stop its own work and publish the resulting state. */
  | {
      kind: "progress";
      value: number | null;
      max?: number;
      label?: string;
      showValue?: boolean;
      cancel?: Pick<PluginAction, "id" | "label" | "run">;
    }
  | { kind: "tags"; label?: string; values: string[] }
  | {
      kind: "alert";
      title?: string;
      message: string;
      variant?: "default" | "destructive" | "success";
    }
  | { kind: "divider" }
  /** A titled vertical group with design-system-owned hierarchy and spacing. */
  | {
      kind: "section";
      title?: string;
      description?: string;
      blocks: PluginBlock[];
      gap?: PluginLayoutGap;
    }
  /** A vertical group for composing blocks without introducing raw layout. */
  | { kind: "group"; blocks: PluginBlock[]; gap?: PluginLayoutGap }
  /**
   * Responsive, host-owned columns. Plugins may choose relative weight,
   * minimum-width preset, spacing, and vertical alignment; wrapping and exact
   * CSS remain owned by the design system. Nesting is allowed to a bounded
   * depth and is validated at runtime.
   */
  | {
      kind: "columns";
      cells: PluginColumnCell[];
      gap?: PluginLayoutGap;
      align?: "start" | "center" | "baseline" | "stretch";
    }
  /**
   * Backward-compatible single-block columns. Prefer `columns`, whose cells
   * may contain a composed block sequence.
   */
  | { kind: "row"; cells: PluginRowCell[]; align?: "start" | "center" | "baseline" }
  | PluginListView
  | PluginTableView
  | PluginTreeView
  | PluginImageView
  | PluginEditorView
  | PluginFormView;

export type PluginColumnCell = {
  weight?: number;
  minWidth?: "compact" | "standard" | "wide";
  blocks: PluginBlock[];
};

/** One column of a `row` block. */
export type PluginRowCell = {
  /** Relative width among the row's cells (default 1); clamped to >= 0. */
  weight?: number;
  block: PluginRowCellBlock;
};

/** Legacy row cells stay single-block; runtime validation bounds recursion. */
export type PluginRowCellBlock = PluginBlock;

export type PluginViewContent = (
  | PluginMarkdownView
  | PluginListView
  | PluginTableView
  | PluginTreeView
  | PluginImageView
  | PluginEditorView
  | PluginFormView
  | PluginBlocksView
  | PluginDetailView
) & {
  /** Views 1.10: a host-labelled drop zone for this visible view. Dropping grants
   * this activation read access to the selected file snapshots, never paths.
   * Defaults to one file; multiple accepts at most 16. Release resources when done.
   * User drops or the host chooser invoke this; it does not intercept other app surfaces. */
  fileDrop?: {
    multiple?: boolean;
    extensions?: string[];
    onDrop(resources: import("@read-aware/core").ResourceRef[]): PluginViewResult | Promise<PluginViewResult>;
  };
};

/** Issued by the host for one visible frame; never saved or reused after disposal. */
export type PluginViewChannel = { id: string };
export type PluginViewUpdate = { revision: number; view: PluginViewContent };
export type PluginViewUpdateReceipt = { status: "applied" | "stale" | "inactive" };
export type PluginViewCloseReason = "closed" | "back" | "replaced" | "reset" | "refreshed" | "unmounted";
/** Error copy and retry eligibility are host-owned; never pass a raw Error/message. */
export type PluginToast = string | { kind: "error"; code: string; retry?: () => void | Promise<void> };
export type PluginView = PluginViewContent & {
  /** Once when this accepted frame is removed, not when covered or live-updated.
   * Notification only: cannot veto closing or return navigation. Not guaranteed after
   * activation retirement/crash; use activate's disposer for activation resources. */
  onClose?(event: { reason: PluginViewCloseReason }): void | Promise<void>;
  /** Subscribed only while this frame is visible. Publish full snapshots through ui.publishView.
   * Return a disposer; hiding/back/close/retirement invalidates the channel immediately.
   * Each subscription must send its current snapshot before subsequent changes. */
  live?: { subscribe(channel: PluginViewChannel): PluginDisposable | Promise<PluginDisposable> };
};

/**
 * What an action / list-select / form-submit may produce:
 * - `undefined` / `null` — nothing happens (surface stays as is);
 * - `{ toast }` — a transient notice;
 * - `{ view }` — open (or push onto) the surface with this view;
 * - `{ view, navigation: "replace" | "reset" }` — replace the current view
 *   or return the surface to a new root view;
 * - `{ close: true }` — dismiss the current surface (composable with `toast`);
 * - `{ close: "all" }` — since views 1.9, dismiss this presentation and its
 *   nested plugin dialogs, not another plugin presentation or native viewer;
 * - `{ fieldErrors }` (from a form submit) — stay on the form and show the
 *   errors under their fields.
 */
export type PluginViewResult =
  | void
  | undefined
  | null
  | {
      toast?: PluginToast;
      view?: PluginView;
      navigation?: "push" | "replace" | "reset";
      close?: boolean | "all";
      fieldErrors?: Record<string, string>;
    };

// ─── UI contributions ────────────────────────────────────────────────────────

/** Where a selection action was triggered from. */
export type SelectionActionSource = "selection" | "annotation" | "navigator";

export type SelectionActionInput = {
  /** The whole selected text with whitespace runs collapsed — never truncated. For the
   * annotation and navigator sources, the annotation's or navigator unit's text. */
  text: string;
  /** Surrounding passage when the reader can recover it. */
  context?: string;
  /** CFI range of the selection/annotation, when the engine can anchor it. */
  cfiRange: string | null;
  /** Since selectionActions 1.2: captured source reference. Null for legacy annotations or unavailable anchors. */
  range?: import("@read-aware/core").BookTextRange | null;
  chapterHref: string | null;
  book: { id: string; title: string; author?: string };
  source: SelectionActionSource;
};

/** Full presentation snapshot. Hidden or disabled actions reject new execution.
 * revision is a non-negative safe integer; initial omission defaults to 0/true/true.
 * checked is presentation only and does not toggle itself or grant authority. */
export type PluginActionState = { revision: number; visible: boolean; enabled: boolean; checked?: boolean };
/** applied acknowledges host state, not DOM paint or durable business completion. */
export type PluginActionStateReceipt = { status: "applied" | "stale" | "inactive" };
/** Since the four interactive contribution points v1.1. State belongs to this
 * exact registration. Replaced/disposed handles are inactive; old revisions stale.
 * Updates require an active plugin and do not cancel already-started operations. */
export type PluginActionRegistration = PluginDisposable & {
  updateState(state: PluginActionState): Promise<PluginActionStateReceipt>;
};

/** Selection/annotation menu entry. May run silently, report a toast or open a view.
 * It appears on every source (selection, annotation, navigator); branch on
 * `input.source` inside `run` when an action only makes sense on some. */
export type PluginSelectionAction = {
  state?: PluginActionState;
  id: string;
  title: PluginText;
  icon?: string;
  /** Optional host semantic used by the matching keyboard command. */
  role?: "lookup";
  /** Opens the host Dialog immediately in a loading state before `run` resolves. */
  presentation?: "dialog";
  run: (input: SelectionActionInput) => PluginViewResult | Promise<PluginViewResult>;
};

export type PluginHeaderSurface = "shelf" | "reader" | "agent";

export type HeaderActionInput = {
  /** Present on the reader surface: the open book. */
  book?: { id: string; title: string; author?: string };
  /** Agent page: selected global thread, which may not yet have persisted turns. */
  thread?: { kind: "global"; id: string };
};

/**
 * An icon button on a header bar. On the reader surface the view always opens
 * as an anchored Popup; on the shelf it opens as a Popup or a full Page,
 * per `presentation`.
 */
export type PluginHeaderAction = {
  state?: PluginActionState;
  id: string;
  title: PluginText;
  icon?: string;
  surface: PluginHeaderSurface;
  /** Shelf only; reader and Agent headers always open a popup. */
  presentation?: "popup" | "page";
  view: (input: HeaderActionInput) => PluginView | Promise<PluginView>;
};

/** User-selected target metadata only; reading or mutating it still requires domain grants. */
export type ContextActionInput =
  | { surface: "book"; book: { id: string; title: string; author?: string } }
  | { surface: "collection"; collection: { id: string; name: string } };

export type PluginContextAction = {
  id: string;
  title: PluginText;
  icon?: string;
  surface: ContextActionInput["surface"];
  /** Registration-wide state, not a separate state for each target. */
  state?: PluginActionState;
  presentation?: "dialog";
  run(input: ContextActionInput): PluginViewResult | Promise<PluginViewResult>;
};

// ─── Reader-mode contributions ──────────────────────────────────────────────

/**
 * Plugin-owned copy with an English/default fallback. Locale keys are BCP-47
 * tags; the host resolves the active locale and always renders the result.
 */
export type PluginLocalizedText = {
  default: string;
  translations?: Record<string, string>;
};

/**
 * User-visible copy a contribution carries: a plain string, or a localized
 * bundle resolved against the app locale (exact tag, then base language,
 * then `default`). Contribution titles and tool labels accept this shape.
 */
export type PluginText = string | PluginLocalizedText;

/** One semantic step size declared by a text-unit reader mode. */
export type PluginReaderTextUnit = {
  id: string;
  /** Label used by the host's settings control. */
  label: PluginLocalizedText;
  previousLabel: PluginLocalizedText;
  nextLabel: PluginLocalizedText;
  /** Label for the host-rendered quick toggle. Defaults to `label`. */
  toggleLabel?: PluginLocalizedText;
  /** Curated host icon name. Plugins cannot supply SVG or UI code. */
  icon?: string;
};

/**
 * Copy for every host-rendered surface belonging to the mode.
 *
 * Behavior settings (step unit, tap-to-advance, …) are NOT copy: the plugin
 * declares them as ordinary `manifest.settings` fields under the well-known
 * ids `unitId`, `tapToAdvance`, `scrollToStep`, `showProgress`,
 * `sessionTimer`, and the host reads those values from the plugin's settings
 * object. Its settings page is the one editing surface.
 */
export type PluginReaderModeCopy = {
  title: PluginLocalizedText;
  enable: PluginLocalizedText;
  exit: PluginLocalizedText;
  returnToCurrent: PluginLocalizedText;
  showToolbars: PluginLocalizedText;
  moreActions: PluginLocalizedText;
  collapseActions: PluginLocalizedText;
  menuLabel: PluginLocalizedText;
  shortcuts: {
    description: PluginLocalizedText;
    volumeKeys: PluginLocalizedText;
  };
};

/**
 * One half-open span (`start <= offset < end`) inside a text block supplied by
 * the reader host. The host maps offsets back to Foliate DOM Ranges; plugins
 * never receive a Document, Range, iframe, or engine instance.
 */
export type PluginReaderTextSegment = {
  start: number;
  end: number;
};

export type PluginReaderTextSegmentInput = {
  /** Plain text from one host-detected block in the current reflowable section. */
  text: string;
  /** The section document's language tag, when the book declares one. */
  language?: string;
  /** One of the registering mode's declared `units[].id` values. */
  unitId: string;
};

/**
 * A guided reader mode over host-owned text units. The plugin supplies unit
 * semantics, localized copy, curated icon names, and segmentation policy;
 * ReadAware owns section traversal, CFI mapping, overlays, input capture,
 * persistence, actions, settings, and every rendered control.
 *
 * `reader:modes` is currently reserved for bundled first-party plugins while
 * this privileged lifecycle contract settles.
 */
export type PluginReaderMode = {
  id: string;
  kind: "text-unit-navigator";
  /** Curated host icon used for the reader-header entry. */
  icon?: string;
  /** Semantic units exposed through host-owned settings and controls. */
  units: PluginReaderTextUnit[];
  defaultUnitId: string;
  copy: PluginReaderModeCopy;
  /** Segment one block. Results must be ordered, non-overlapping spans.
   * readerModes 1.1 permits async providers. Failure rejects the section build;
   * returning [] deliberately declares this block has no reading units. */
  segmentText(input: PluginReaderTextSegmentInput): PluginReaderTextSegment[] | Promise<PluginReaderTextSegment[]>;
};

/**
 * A key chord for a command's default binding. `mod` is the platform command
 * key (⌘ on macOS, Ctrl elsewhere); `key` is a `KeyboardEvent.key`, single
 * characters lowercased.
 */
export type PluginShortcut = {
  key: string;
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
};

/** A command-palette entry. */
export type PluginCommand = {
  state?: PluginActionState;
  id: string;
  title: PluginText;
  icon?: string;
  /** Extra text folded into palette matching. */
  keywords?: string;
  /**
   * Optional default key binding. Every registered command is bindable in
   * Settings → Shortcuts whether or not it declares one; the user can rebind
   * it there, and their override wins over this default.
   */
  defaultShortcut?: PluginShortcut;
  run: () => PluginViewResult | Promise<PluginViewResult>;
};

/**
 * A tool exposed to the reading agent. `parameters` is plain JSON Schema for
 * the arguments object; omit it for a no-argument tool. The registered tool is
 * namespaced `plugin_<pluginId>_<name>` before it reaches the model.
 */
export type PluginToolDefinition = {
  state?: PluginActionState;
  /** agentTools >=1.2: host confirmation of this exact call before execute.
   * Requires a manifest range excluding older hosts. Does not grant new permissions. */
  approval?: "required";
  /** snake_case identifier, unique within the plugin. */
  name: string;
  /** Short human label shown in the chat's tool activity row. */
  label?: PluginText;
  description: string;
  /**
   * Agent surfaces where this tool is useful. Omit for both surfaces so older
   * plugins keep their existing behavior; focused tools should opt into the
   * narrowest useful set to avoid crowding the model's tool context.
   */
  contexts?: Array<"book" | "global">;
  parameters?: Record<string, unknown>;
  /**
   * Resolve with any JSON value — it is serialized as the tool result the
   * model reads. Resolve with `{ gist, wordCards }` (PluginToolWordCards) to
   * additionally render word cards in the chat turn: the reader sees the full
   * entries as cards at the tool's position, the model sees only `gist`.
   * agentTools >=1.3 also accepts PluginToolBookCards: host-resolved shelf
   * cards, requiring library read access; the model receives gist and ID receipts.
   */
  execute: (params: Record<string, unknown>) => unknown | Promise<unknown>;
};

/** One word card a tool result can carry (full entry, host-rendered). */
export type PluginToolWordCard = {
  /** The headword, in its original language. */
  term: string;
  /** Human-readable name of the language the entry explains in. */
  language: string;
  entry: PluginDictionaryEntry;
};

/**
 * Card-carrying tool result: `gist` is what the model receives (keep it to a
 * one-line summary — the card IS the content); `wordCards` render as word
 * cards in the chat.
 */
export type PluginToolWordCards = {
  gist: unknown;
  wordCards: PluginToolWordCard[];
};

/** Host-rendered shelf cards (agentTools >=1.3, library:read/write).
 * 1..24 references, each bookId nonblank and at most 256 characters.
 * Duplicates collapse; unknown books are skipped. A book thread can show only
 * its current book, a global thread any authorized shelf book. No custom
 * titles, covers, URLs or mixing with wordCards; rendering does not open books. */
export type PluginToolBookCards = {
  gist: unknown;
  bookCards: Array<{ bookId: string }>;
};

// ─── Events ──────────────────────────────────────────────────────────────────

/**
 * A domain event as delivered to a plugin subscription: the canonical type +
 * payload from the app's event catalog (@read-aware/core events.ts), with the
 * software-actor origin and display timestamp. Persistence internals (HLC,
 * event ids) are not part of the plugin surface.
 */
/** Host-issued causal lease. Opaque: it conveys no permission or object grant.
 * Retained only until the asynchronous subscription callback settles. */
export type PluginReactionToken = Readonly<{ id: string; status: "ready" | "cycle" }>;
export type PluginReactionEvent = { readonly reaction?: PluginReactionToken };

/** Plugins 1.3: observation snapshots keep their existing shape. Use the second
 * argument with ctx.withEvent for automatic follow-up operations. */
export type PluginObservationHandler<T> = (snapshot: T, delivery?: PluginReactionEvent) => unknown;

export type PluginDomainEvent<K extends DomainEventType = DomainEventType> = {
  [T in DomainEventType]: {
    type: T;
    payload: Extract<DomainEvent, { type: T }>["payload"];
    createdAt: string;
    origin: EventOrigin;
    readonly reaction?: PluginReactionToken;
  };
}[K];

/** Subscribe helper: one domain's event names, canonical, fully typed. */
export type DomainSubscribe<E extends DomainEventType> = <K extends E>(
  event: K,
  /** An async handler keeps its event reaction until the returned promise settles. */
  handler: (event: PluginDomainEvent<K>) => unknown,
  options?: {
    /**
     * Skip events produced by this plugin's own writes (origin
     * `plugin:<id>`). Default false — by default you hear your own echoes.
     */
    ignoreSelf?: boolean;
    /** Stable rule identity within this plugin (plugins 1.9). Reuse the same
     * name after activation/restart; do not reuse it for a different rule.
     * Lowercase identifier, up to 128 characters; unique while subscribed.
     * Omit for an activation-local identity. This grants no write permission. */
    ruleId?: string;
  },
) => PluginDisposable;

/** Book, source, metadata, and collection changes. */
export type LibraryDomainEventType =
  | "book.imported"
  | "book.metadataEdited"
  | "book.coverExtracted"
  | "book.merged"
  | "book.starred"
  | "book.removed"
  | "collection.created"
  | "collection.renamed"
  | "collection.removed"
  | "book.addedToCollection"
  | "book.removedFromCollection";

/** Active-reading lifecycle, progress, verdicts, and time. */
export type ReadingDomainEventType = import("@read-aware/core").ReadingDomainEventType;

export type AnnotationDomainEventType =
  | "highlight.created"
  | "highlight.recolored"
  | "highlight.removed"
  | "note.created"
  | "note.updated"
  | "note.removed"
  | "ask.recorded"
  | "ask.removed";

export type ConversationDomainEventType =
  | "aiConversation.started"
  | "aiMessage.appended"
  | "aiMessage.removed"
  | "aiConversation.cleared";

// ─── Read models (projections as plugins see them) ───────────────────────────
//
// These are the CANONICAL domain read models from @read-aware/core
// (read-models.ts), re-exported under this contract's public names — the
// same shapes the app's own surfaces and the agent's ports consume, so the
// three actors cannot drift apart.

export type PluginBook = BookSummary;

export type PluginCollection = CollectionSummary;

export type PluginHighlight = HighlightItem;

export type PluginNote = NoteItem;

/** A passive trace of a question asked in the book thread (agent-written). */
export type PluginAsk = AskItem;

export type PluginAnnotation = AnnotationItem;

/** One book's reading position, status, and time. */
export type PluginBookStats = BookStats;

/** Aggregate over every book's recorded reading. */
export type PluginStatsOverview = StatsOverview;

/**
 * A structured dictionary entry — the shape the `dictionary` view kind and
 * word-card tool results render with the app's own dictionary UX. Producing
 * entries is plugin business (e.g. via `llm.ask` with a schema); this is the
 * presentation contract.
 */
export type PluginDictionaryEntry = DictionaryEntrySnapshot;

export type PluginChatMessage = ChatMessageSummary;

export type PluginThreadSummary = ThreadSummary;

export type PluginChapterRef = ChapterRef;

export type PluginBookContent = {
  title?: string;
  author?: string;
  language?: string;
  sections: { id?: string; title?: string; html: string }[];
};

// ─── Domain APIs ─────────────────────────────────────────────────────────────

export type PluginLibraryDomain = {
  queries: {
    books: {
      list(): Promise<PluginBook[]>;
      /** Library 1.11: import routing hints; extensions alone do not prove readability. */
      listFormats(): Promise<import("@read-aware/core").BookFormatCapability[]>;
      /** Initialize this activation's sealed resource with the reader parser; no import. */
      inspectResource(id: string, options?: PluginCallOptions): Promise<import("@read-aware/core").BookInspection>;
      /** Library 1.10: same-content groups; live offset pages, limit 1-50. */
      listDuplicates(
        query?: import("@read-aware/core").DuplicateBookQuery,
      ): Promise<import("@read-aware/core").DuplicateBookPage>;
      previewMerge(bookId: string): Promise<import("@read-aware/core").BookMergePreview | null>;
      /** Current book ID or merge redirect, null if neither points to a living book. */
      resolveId(bookId: string): Promise<string | null>;
      /** Durable device-local pending file cleanup, including after view/plugin restart. Live keyset page, limit 1-100 (default 50). */
      listRemovalCleanup(
        query?: import("@read-aware/core").BookRemovalCleanupQuery,
      ): Promise<import("@read-aware/core").BookRemovalCleanupPage>;
      get(bookId: string): Promise<PluginBook | null>;
      getToc(bookId: string): Promise<PluginChapterRef[]>;
      /** Read-only derived-text state. Never starts parsing, fetching, or extraction. */
      getTextState(bookId: string): Promise<import("@read-aware/core").BookTextSnapshot>;
      /** Library 1.9: local cover/source state and the latest process-local enrichment attempt. */
      getEnrichment(bookId: string): Promise<import("@read-aware/core").BookEnrichmentSnapshot>;
      /** Source metadata only; never loads a provider or reveals reading state. Library 1.16. */
      getContentState(
        bookId: string,
        options?: PluginCallOptions,
      ): Promise<import("@read-aware/core").BookContentState>;
      listTextTaskHistory(
        bookId: string,
        query?: import("@read-aware/core").BookTextTaskHistoryQuery,
      ): Promise<import("@read-aware/core").BookTextTaskHistoryPage>;
      getTextTask(bookId: string, taskId: string): Promise<import("@read-aware/core").BookTextTaskSnapshot>;
      listTextTasks(bookId: string): Promise<import("@read-aware/core").BookTextTaskSnapshot[]>;
      /** Library 1.20: this activation's in-memory import handles (64 retained). */
      /** waitMs (0..30000) waits for terminal state or returns current progress at the deadline.
       * Cancelling this query stops observation only. */
      getImportTask(
        taskId: string,
        waitMs?: number,
        options?: PluginCallOptions,
      ): Promise<import("@read-aware/core").BookImportTaskSnapshot>;
      listImportTasks(): Promise<import("@read-aware/core").BookImportTaskSnapshot[]>;
      getChapterText(bookId: string, chapterIndex: number): Promise<string | null>;
      getNavigationToc(
        bookId: string,
        options?: PluginCallOptions,
      ): Promise<import("@read-aware/core").BookNavigationToc>;
      /** Library 1.14: bounded source-section or author-supplied page-label catalog; not screen page counts. */
      listNavigationTargets(
        input: import("@read-aware/core").BookNavigationTargetsQuery,
        options?: PluginCallOptions,
      ): Promise<import("@read-aware/core").BookNavigationTargetsPage>;
      searchLocations(
        input: import("@read-aware/core").BookLocationSearch,
        options?: PluginCallOptions,
      ): Promise<import("@read-aware/core").BookLocationSearchPage>;
      readRange(
        input: import("@read-aware/core").BookRangeQuery,
        options?: PluginCallOptions,
      ): Promise<import("@read-aware/core").BookRangePage>;
      /** Library 1.12: versioned section references, not extracted chapter indices. */
      listReferences(
        input: import("@read-aware/core").BookReferencesQuery,
        options?: PluginCallOptions,
      ): Promise<import("@read-aware/core").BookReferencesPage>;
      /** Library 1.29: section-local img/SVG, srcset/authored CSS and PDF image candidates. No remote fetch; PDF operator inspection can decode objects. */
      listImages(
        input: import("@read-aware/core").BookImagesQuery,
        options?: PluginCallOptions,
      ): Promise<import("@read-aware/core").BookImagesPage>;
      /** Seal an embedded image as this activation's ResourceRef; does not display it or decode pixels. */
      openImageResource(
        input: import("@read-aware/core").BookImageQuery,
      ): Promise<import("@read-aware/core").BookImageResource>;
      /** Plain-text preview and resolved navigation location; never fetches or opens an external URL. */
      readReference(
        input: import("@read-aware/core").BookReferenceQuery,
        options?: PluginCallOptions,
      ): Promise<import("@read-aware/core").BookReferencePreview>;
      /** Multi-query derived prose search. Single-book may prepare text; shelf search never does. Results are not navigation locations. */
      searchText(
        input: import("@read-aware/core").BookTextSearch,
        options?: PluginCallOptions,
      ): Promise<import("@read-aware/core").BookTextHit[]>;
    };
    collections: {
      list(): Promise<PluginCollection[]>;
      booksIn(collectionId: string): Promise<string[]>;
    };
  };
  commands?: {
    books: {
      /** Library 1.31: starts an actor-owned background request. A receipt is not completion.
       * Current-book grants fence admission and the lease through pause/resume;
       * switching books cancels only this request, without undoing accepted writes. */
      prepareText(
        bookId: string,
        options?: import("@read-aware/core").BookTextPrepareOptions,
      ): Promise<import("@read-aware/core").BookTextTaskSnapshot>;
      /** Retry unchecked covers and missing/filename-derived metadata using the shared queue, without forcing replacement or download. */
      retryEnrichment(bookId: string): Promise<import("@read-aware/core").BookEnrichmentReceipt>;
      /** Conditional record merge with the host's deterministic keeper; not file deletion or undo. */
      mergeDuplicates(
        input: import("@read-aware/core").BookMergeRequest,
      ): Promise<import("@read-aware/core").BookMergeReceipt>;
      /** Library 1.21: pauses only this request by releasing its lease; other consumers and dispatched I/O may continue. */
      setTextTaskPriority(
        bookId: string,
        taskId: string,
        priority: import("@read-aware/core").BookTextPriority,
      ): Promise<import("@read-aware/core").BookTextTaskSnapshot>;
      pauseTextTask(bookId: string, taskId: string): Promise<import("@read-aware/core").BookTextTaskSnapshot>;
      /** Library 1.21: reacquires this paused request using saved checkpoints and the same handle. */
      resumeTextTask(bookId: string, taskId: string): Promise<import("@read-aware/core").BookTextTaskSnapshot>;
      /** Cancels only this activation's request; shared work or dispatched writes may continue. */
      cancelTextTask(bookId: string, taskId: string): Promise<import("@read-aware/core").BookTextTaskSnapshot>;
      importBook(
        input: {
          fileName: string;
          data: ArrayBuffer | Uint8Array;
        },
        options?: PluginCallOptions,
      ): Promise<PluginBook>;
      /** Library 1.19 adds per-call cancellation. Before the first durable write,
       * cancellation prevents admission; afterward await the actual imported/duplicate
       * receipt or failure. No whole-file transfer, opening or resource release. */
      importResource(id: string, options?: PluginCallOptions): Promise<import("@read-aware/core").BookImportReceipt>;
      /** Start a task over owned sealed resources or <=64 MiB file bytes (wire limits still apply).
       * Queued is not imported. options.signal cancels admission only; use cancelImportTask
       * after the receipt. At most 2 physical task executions per activation, 4 in the app;
       * direct imports/picker jobs are outside this task quota.
       * Tasks do not resume after restart. Accepted writes finish despite cancellation. */
      startImport(
        input: import("@read-aware/core").BookImportRequest,
        options?: PluginCallOptions,
      ): Promise<import("@read-aware/core").BookImportTaskSnapshot>;
      cancelImportTask(taskId: string): Promise<import("@read-aware/core").BookImportTaskSnapshot>;
      editMetadata(bookId: string, patch: { title?: string; author?: string }): Promise<void>;
      setStarred(bookId: string, starred: boolean): Promise<void>;
      remove(bookId: string): Promise<void>;
      /** 1-1000 IDs, deduplicated. Atomic record deletion; local file release is separately reported. */
      removeMany(bookIds: string[]): Promise<import("@read-aware/core").BookRemovalReceipt>;
      /** Retry file release only. Refuses any ID now present in the library; never deletes records. */
      retryRemovalCleanup(bookIds: string[]): Promise<import("@read-aware/core").BookFileReleaseReceipt>;
      addVirtualBook(input: { providerId: string; key: string; title: string; author?: string }): Promise<PluginBook>;
      removeVirtualBook(input: { providerId: string; key: string; expectedBookId?: string }): Promise<void>;
      /** Announce already-saved source changes. Does not reload or move the reader.
       * revision is a process-local invalidation fence, not a content hash. Library 1.15. */
      invalidateVirtualBook(input: { providerId: string; key: string }): Promise<{ bookId: string; revision: string }>;
    };
    collections: {
      create(name: string): Promise<PluginCollection>;
      rename(collectionId: string, name: string): Promise<void>;
      remove(collectionId: string): Promise<void>;
      assignBooks(bookIds: string[], collectionId: string | null): Promise<void>;
    };
  };
  events: {
    subscribe: DomainSubscribe<LibraryDomainEventType>;
    /** Library 1.32: serial reaction deliveries retain task and history-write sources. */
    observeTextTask(
      bookId: string,
      taskId: string,
      handler: PluginObservationHandler<import("@read-aware/core").BookTextTaskSnapshot>,
      options?: { ruleId?: string },
    ): PluginDisposable;
    /** Initial snapshot and coalesced monotonic revisions, including terminal failures. */
    observeImportTask(
      taskId: string,
      handler: PluginObservationHandler<import("@read-aware/core").BookImportTaskSnapshot>,
      options?: { ruleId?: string },
    ): PluginDisposable;
    observeEnrichment(
      bookId: string,
      handler: PluginObservationHandler<import("@read-aware/core").BookEnrichmentObservation>,
      options?: { ruleId?: string },
    ): PluginDisposable;
    observeContentState(
      bookId: string,
      handler: PluginObservationHandler<import("@read-aware/core").BookContentObservation>,
      options?: { ruleId?: string },
    ): PluginDisposable;
    /** Initial and coalesced reload hints, including remote projection changes.
     * Re-query authorized data; not an event log or a conditional-write token. */
    observeInvalidation(
      handler: PluginObservationHandler<import("@read-aware/core").ProjectionInvalidation>,
    ): PluginDisposable;
  };
};

/** Library 1.17 / Reading 2.18: optional final argument on supported calls.
 * Cancellation stops waiting and reaches cooperative host work, not rollback.
 * Already-started parsing/IPC or navigation may still finish; realm cleanup drains sources. */
export type PluginCallOptions = { signal?: AbortSignal };

export type PluginReadingDomain = {
  queries: {
    /** This activation's temporary marks only; attached does not mean visible in the viewport. */
    emphasis(): Promise<import("@read-aware/core").ReadingEmphasisSnapshot[]>;
    session(): Promise<import("@read-aware/core").ReadingSessionSnapshot>;
    stats: {
      /** Atomic settled + pending time, with native sampling clock. Reading >=2.7. */
      time(
        query?: import("@read-aware/core").ReadingTimeQuery,
      ): Promise<import("@read-aware/core").ReadingTimeSnapshot>;
      insights(
        query?: import("@read-aware/core").ReadingInsightsQuery,
      ): Promise<import("@read-aware/core").ReadingInsights>;
      forBook(bookId: string): Promise<PluginBookStats | null>;
      list(): Promise<PluginBookStats[]>;
      overview(): Promise<PluginStatsOverview>;
    };
  };
  commands?: {
    /** Temporary owned marks, not annotations. No navigation; replacement requires an observed revision. */
    putEmphasis(
      input: import("@read-aware/core").ReadingEmphasisWrite,
      guard?: import("@read-aware/core").ReadingSessionGuard,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").ReadingEmphasisReceipt>;
    removeEmphasis(
      input: import("@read-aware/core").ReadingEmphasisRef,
      guard?: import("@read-aware/core").ReadingSessionGuard,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").ReadingEmphasisRemoval>;
    /** Requires this book to be open; validates its source range, navigates, then waits for the selection overlay commit. */
    selectRange(
      range: import("@read-aware/core").BookTextRange,
      guard?: import("@read-aware/core").ReadingSessionGuard,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").ReadingSelectionReceipt>;
    /** Clears only the observed selection ID; a replacement selection is never silently cleared. */
    clearSelection(
      expectedId: string,
      guard?: import("@read-aware/core").ReadingSessionGuard,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").ReadingSelectionReceipt>;
    /** Set reader chrome visibility; completes after UI commit. Does not alter panel preferences or playback. */
    setControls(
      visible: boolean,
      guard?: import("@read-aware/core").ReadingSessionGuard,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").ReadingControlsReceipt>;
    setFinished(bookId: string, finished: boolean): Promise<void>;
    openBook(bookId: string, options?: PluginCallOptions): Promise<import("@read-aware/core").ReadingNavigationReceipt>;
    goTo(
      target: import("@read-aware/core").ReadingTarget,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").ReadingNavigationReceipt>;
    back(
      guard?: import("@read-aware/core").ReadingSessionGuard,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").ReadingNavigationReceipt>;
    forward(
      guard?: import("@read-aware/core").ReadingSessionGuard,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").ReadingNavigationReceipt>;
    /** Reading 2.12: page, source-section and book-boundary navigation; section/boundary jumps enter history. */
    step(
      direction: import("@read-aware/core").ReadingStep,
      guard?: import("@read-aware/core").ReadingSessionGuard,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").ReadingNavigationReceipt>;
    /** Reading 2.21: reopen source; virtual sections with identical stable identity/content preserve their location across reorder. Stale/legacy virtual locators restart at the beginning; files still restart. Whole-book contentVersion guards remain strict. */
    reload(
      guard?: import("@read-aware/core").ReadingSessionGuard,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").ReadingNavigationReceipt>;
    close(guard?: import("@read-aware/core").ReadingSessionGuard, options?: PluginCallOptions): Promise<void>;
    /** Start resolves on actual audio start. Stop is idempotent; disabling the initiating plugin stops its playback. */
    controlPlayback(
      action: "start" | "stop",
      guard?: import("@read-aware/core").ReadingSessionGuard,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").ReadingPlaybackReceipt>;
    /** Configure the host mode; modeKey guards the current provider, selectModeKey selects from session().mode.availableModes.
     * Resolves after real indexing (ready/empty) or deactivation. Failed indexing rejects.
     * Disabling the caller cancels an unfinished change; completed mode preferences remain. */
    configureMode(
      input: import("@read-aware/core").ReadingModeConfiguration,
      guard?: import("@read-aware/core").ReadingSessionGuard,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").ReadingModeReceipt>;
    /** Return to the versioned resting unit; wait for renderer navigation and unit restoration before committing history. */
    returnToMode(
      guard?: import("@read-aware/core").ReadingSessionGuard,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").ReadingNavigationReceipt>;
    /** Step one configured text unit, across sections if necessary; reports book boundaries explicitly. */
    stepMode(
      direction: "next" | "previous",
      guard?: import("@read-aware/core").ReadingSessionGuard,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").ReadingModeStepReceipt>;
  };
  events: {
    subscribe: DomainSubscribe<ReadingDomainEventType>;
    /** Immediate and subsequent snapshots carry a live reaction lease. Use withEvent for automatic writes;
     * keep the original context for later user actions. A stable ruleId can resume job causality across activations. */
    observeSession(
      handler: (
        snapshot: import("@read-aware/core").ReadingSessionSnapshot,
        delivery?: PluginReactionEvent,
      ) => void | Promise<void>,
      options?: { ruleId?: string },
    ): PluginDisposable;
    observeEmphasis(
      handler: (
        snapshot: import("@read-aware/core").ReadingEmphasisSnapshot[],
        delivery?: PluginReactionEvent,
      ) => void | Promise<void>,
    ): PluginDisposable;
    /** Immediate sample then a 1s minimum gap after each delivery. Errors are explicit; dispose stops further delivery.
     * Reading 2.24: delivery retains sampling subscription ancestry across timers.
     * It does not identify historical writers of the aggregate. */
    observeTime(
      query: import("@read-aware/core").ReadingTimeQuery,
      handler: (
        event: import("@read-aware/core").ReadingTimeObservation,
        delivery?: PluginReactionEvent,
      ) => void | Promise<void>,
      options?: { ruleId?: string },
    ): PluginDisposable;
  };
};

export type { AnnotationObservationQuery, AnnotationObservationResult, AnnotationObservation } from "@read-aware/core";
/**
 * Annotations — highlights, notes, and asks. Ask creation belongs to the
 * agent runtime; authorized writers may erase the user's existing traces.
 * Since 2.2, reads reject oversized items (512 KiB), pages are bounded to 1 MiB,
 * and list rejects collections requiring multiple pages. Use page and nextCursor.
 */
export type PluginAnnotationsDomain = {
  queries: {
    /** annotations >=1.3.0. Read an item and its conditional-write token atomically. */
    inspect(annotationId: string): Promise<import("@read-aware/core").AnnotationSnapshot | null>;
    /** annotations >=1.2.0. Live keyset page, not a frozen snapshot across calls. */
    page(input?: import("@read-aware/core").AnnotationPageQuery): Promise<import("@read-aware/core").AnnotationPage>;
    /** annotations >=1.1.0. Missing IDs return null; read failures reject. */
    get(annotationId: string): Promise<PluginAnnotation | null>;
    list(filter?: {
      bookId?: string;
      kind?: "highlight" | "note" | "ask";
      query?: string;
    }): Promise<PluginAnnotation[]>;
  };
  commands?: {
    /** Since 2.0 this is the only edit/delete entry. Use the revision observed
     * before the user's decision; 1..100 distinct items, all commit or none. */
    applyChanges(
      changes: import("@read-aware/core").AnnotationMutation[],
    ): Promise<import("@read-aware/core").AnnotationCommitResult>;
    /** annotations >=2.1: range validates and preserves the captured source; requires library:read. */
    createHighlight(input: {
      range?: import("@read-aware/core").BookTextRange;
      bookId: string;
      text: string;
      anchor?: string | null;
      chapterHref?: string | null;
      color?: HighlightColor;
      style?: HighlightStyle;
    }): Promise<PluginHighlight>;
    createNote(input: {
      range?: import("@read-aware/core").BookTextRange;
      bookId: string;
      body: string;
      quotedText?: string;
      anchor?: string | null;
      chapterHref?: string | null;
    }): Promise<PluginNote>;
  };
  events: {
    subscribe: DomainSubscribe<AnnotationDomainEventType>;
    /** Since 1.4. Initial authorized snapshot, then changed results/errors/recovery. Disposal ends polling. */
    observe(
      query: import("@read-aware/core").AnnotationObservationQuery,
      handler: PluginObservationHandler<import("@read-aware/core").AnnotationObservation>,
    ): PluginDisposable;
  };
};

/**
 * Conversations 1.5 supports current/specified-book grants for book transcripts,
 * summaries, runtime, actor-owned turn requests, events and stop/clear controls.
 * listThreads/getThread/createThread/selectThread are global-thread operations
 * requiring an all-books grant. Restricted runtime revisions reflect only the
 * visible book/session state, and selectedGlobalThreadId is null. Pending proposals
 * retire on a current-book/session change; only host acceptance starts a turn.
 * Message generation stays with the host chat runtime.
 */
/** A book-scoped installation receives no selected global thread identity. */
export type PluginConversationRuntimeSnapshot = Omit<
  import("@read-aware/core").ConversationRuntimeSnapshot,
  "selectedGlobalThreadId"
> & {
  selectedGlobalThreadId: string | null;
};

export type PluginConversationsDomain = {
  queries: {
    /** Conversations 1.4: stored rolling summary of a book/global thread, or null.
     * No generation, freshness guarantee, raw runtime state or summary writes. */
    getInsights(target: import("@read-aware/core").ConversationTarget): Promise<string | null>;
    /** Up to 128 recently retained host requests, filtered to this actor; no text or other actors' requests. */
    turnRequests(): Promise<import("@read-aware/core").ConversationTurnRequestSnapshot[]>;
    runtime(): Promise<PluginConversationRuntimeSnapshot>;
    getBookThread(bookId: string): Promise<PluginChatMessage[]>;
    listThreads(): Promise<PluginThreadSummary[]>;
    getThread(threadId: string): Promise<PluginChatMessage[]>;
  };
  commands?: {
    /** Requires a mounted conversation. Only a host UI confirmation can adopt/send/retry; receipt is not a completed turn. */
    requestTurn(
      request: import("@read-aware/core").ConversationTurnRequest,
    ): Promise<import("@read-aware/core").ConversationTurnRequestSnapshot>;
    cancelTurnRequest(id: string): Promise<import("@read-aware/core").ConversationTurnRequestSnapshot>;
    /** Creates and selects a global draft; no transcript row until the first message. Does not navigate the app. */
    createThread(): Promise<import("@read-aware/core").ConversationControlReceipt & { draft: true }>;
    selectThread(threadId: string): Promise<import("@read-aware/core").ConversationControlReceipt>;
    /** Stops live UI turns and waits for their final transcript writes. Does not undo tool effects. */
    stop(
      target: import("@read-aware/core").ConversationTarget,
    ): Promise<import("@read-aware/core").ConversationControlReceipt>;
    /** Clears transcript/hidden thread state after draining turns, not long-term memory or event history. */
    clear(
      target: import("@read-aware/core").ConversationTarget,
    ): Promise<import("@read-aware/core").ConversationControlReceipt>;
  };
  events: {
    subscribe: DomainSubscribe<ConversationDomainEventType>;
    observeInvalidation(
      handler: PluginObservationHandler<import("@read-aware/core").ProjectionInvalidation>,
    ): PluginDisposable;
    /** Conversations 1.6: serial reaction deliveries, with an optional stable rule ID. */
    observeRuntime(
      handler: PluginObservationHandler<PluginConversationRuntimeSnapshot>,
      options?: { ruleId?: string },
    ): PluginDisposable;
  };
};

export type PluginSettingsDomain = {
  queries: {
    /** Settings 1.9: cached public model metadata; discover access to primaryModel or fastModel. No network. */
    modelCatalog(
      query: import("@read-aware/core").ModelCatalogQuery,
    ): Promise<import("@read-aware/core").ModelCatalogPage>;
    /** Since settings 1.3: one host snapshot after prior queued writes settle, filtered by exact path grants. */
    snapshot(query?: SettingsQuery): Promise<import("@read-aware/core").SettingsSnapshot>;
    /** Settled snapshots after native, domain, remote, restore and catalog changes. Coalesces slow callbacks. */
    observe(
      query: SettingsQuery,
      handler: PluginObservationHandler<import("@read-aware/core").SettingsObservation>,
    ): PluginDisposable;
    discover(query?: SettingsQuery): Promise<SettingCatalogEntry[]>;
    /** Settings 1.8: bounded options; same path grants as discover. Includes
     * installed system families for reading/content fonts without font paths or bytes.
     * Since 1.10, dynamicOptions fields invoke the registered owning provider with
     * saved non-secret form values, never caller-supplied values. Network-enabled
     * providers additionally require this caller's service:network permission.
     * Results are cached for 60 seconds, at most 16 lists / 2000 options per list,
     * 512 characters per label/value and 1 MiB of label/value JSON. Pages retain
     * the returned revision; changed settings/provider or expiry require restart.
     * Four provider loads host-wide, 10-second wait; already-started provider work
     * is not cancelled by this deadline or caller retirement. No writes/synthesis.
     * Plugin-owned option queries require the caller's active phase, not activation/migration.
     * Empty results still allow manual values; provider failures remain failures. */
    options(
      query: import("@read-aware/core").SettingsOptionsQuery,
    ): Promise<import("@read-aware/core").SettingsOptionsPage>;
    read(path: string, target?: SettingsQueryTarget): Promise<SettingReadResult>;
  };
  commands: {
    /** Settings 1.9: additionally requires service:network. Shared native refresh, not a connection test. */
    refreshModelCatalog?(
      provider: string,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").ModelCatalogPage>;
    update(changes: SettingChange[]): Promise<SettingsUpdateResult>;
    /** Settings 1.7: reset the whole reader-preference bundle; every reading path must be writable.
     * defaults restores built-ins; inherit deletes active and remembered book overrides. */
    resetReading(request: import("@read-aware/core").ReadingSettingsReset): Promise<SettingsUpdateResult>;
  };
  events: {
    subscribe(
      /** An async handler keeps its event reaction until the returned promise settles. */
      handler: (event: SettingsChangedEvent & PluginReactionEvent) => unknown,
      options?: { ignoreSelf?: boolean; ruleId?: string },
    ): PluginDisposable;
  };
};

export type { BookGraphTaskOptions, BookGraphTaskSnapshot, BookGraphTaskStatus, DigestReport } from "@read-aware/core";

export type PluginDomains = {
  library?: PluginLibraryDomain;
  reading?: PluginReadingDomain;
  annotations?: PluginAnnotationsDomain;
  conversations?: PluginConversationsDomain;
  /** Memory 2.8 supports current/specified-book grants for book-scoped search,
   * pages, inspect, mutations, classification, graphs/tasks and book context recipes.
   * Restricted queries must name exactly one authorized book scope; global profile
   * and identity APIs require an all-books grant. Current-book/session changes
   * invalidate outstanding reads, observations and exported context resources,
   * and cancel graph execution. Graph generation additionally requires service:llm;
   * handles belong to this activation. Dispatched writes may have committed even
   * if a later scope change prevents disclosure of their result; inspect before retry. */
  memory?: {
    queries: {
      /** Memory 2.4: the versioned context-bundle archive (`docs/architecture/context-bundles.md`). Every recipe also needs
       * read access to the domains it draws on: book_memory_context needs annotations and library, book scopes
       * need library, conversation_insights_context needs conversations. History pages carry versions and
       * publication times only. A pinned read delivers the exact immutable cb1 artifact; a retained
       * book_memory_context is delivered only when the host can place its recorded fence within the reader's
       * current boundary, otherwise it fails rather than being redacted. export seals the same artifact into this
       * activation's resource queue as a read-only `context` ResourceRef bound to the durable source clock: any
       * later tracked source change, reading-position change or retirement revokes reads/saves of that handle,
       * while a native write already dispatched keeps its receipt. Aborted/retired callers receive no late result. */
      context: {
        history(
          query: import("@read-aware/core").ContextBundleHistoryQuery,
          options?: PluginCallOptions,
        ): Promise<import("@read-aware/core").ContextBundleHistoryPage>;
        read(
          query: import("@read-aware/core").ContextBundleReadQuery,
          options?: PluginCallOptions,
        ): Promise<import("@read-aware/core").ContextBundle | null>;
        export(
          query: import("@read-aware/core").ContextBundleReadQuery,
          options?: PluginCallOptions,
        ): Promise<import("@read-aware/core").ResourceRef>;
      };
      /** Memory 2.3: inspect the generated summary and provenance, separately from curated profile().
       * Summary pages count UTF-16 units (4000 default, 16000 max); provenance pages count rows
       * (25 default, 100 max; historical ID sizes are unbounded). Pin every page kind to pctx1.
       * Stale text is inspectable, never current context. Invalid blocks expose no content.
       * Current means source-consistent, not semantic verification or completed consolidation.
       * entityEvidence IDs include proposed no-ops, not proof of emitted events. Read grant;
       * no source text, transcripts, raw traits, registry writes or automatic inference. */
      profileContext(
        query?: import("@read-aware/core").ProfileInspectionQuery,
        options?: PluginCallOptions,
      ): Promise<import("@read-aware/core").ProfileInspectionPage>;
      /** Global explicit identities, not book-digest characters. Row-bounded, revision-pinned pages.
       * Memory 2.2 adds canonicalDefinition from the same snapshot. Historical field sizes are not bounded. Aborted/retired callers receive no late page. */
      entities(
        query?: import("@read-aware/core").EntityQuery,
        options?: PluginCallOptions,
      ): Promise<import("@read-aware/core").EntityPage>;
      /** The event-backed summary projection; read grant, bounded revision-pinned pages. */
      profile(query?: import("@read-aware/core").UserProfileQuery): Promise<import("@read-aware/core").UserProfilePage>;
      inspect(id: string): Promise<import("@read-aware/core").MemorySnapshot | null>;
      classification(bookId: string): Promise<import("@read-aware/core").BookClassificationSnapshot | null>;
      getGraphTask(bookId: string, taskId: string): Promise<import("@read-aware/core").BookGraphTaskSnapshot>;
      listGraphTasks(bookId: string): Promise<import("@read-aware/core").BookGraphTaskSnapshot[]>;
      search(input: import("@read-aware/core").MemoryQuery): Promise<import("@read-aware/core").MemoryRecord[]>;
      page(input: import("@read-aware/core").MemoryPageQuery): Promise<import("@read-aware/core").MemoryPage>;
      /** memory >=2.6 only exposes current-source digests; chapter results carry contentVersion for navigation. */
      bookGraph(
        bookId: string,
        query?: import("@read-aware/core").BookGraphQuery,
      ): Promise<import("@read-aware/core").BookGraphResult>;
    };
    commands?: {
      /** Memory 2.1: resolve an original member or merge known resolved classes using an observed
       * entities1 revision. Present the exact change for confirmation first. Retains original
       * definitions/aliases, may sync to other devices. No blind conflict retry. Cancellation
       * prevents dispatch only; dispatched writes drain to their actual receipt. A transport
       * timeout or lost Worker leaves the outcome unknown: reread, never retry blindly. */
      decideEntity(
        input: import("@read-aware/core").EntityDecision,
        options?: PluginCallOptions,
      ): Promise<import("@read-aware/core").EntityDecisionReceipt>;
      /** Memory 2.4: assemble one recipe from its current durable sources behind the host's own scope, privacy
       * and spoiler authority, publish it as an immutable `context.bundlePublished` version and return the
       * artifact. Requires memory:write plus read access to the recipe's source domains. changed=false means the
       * identical content version already existed. Concurrent source changes reject assembly instead of mixing
       * reads; cancellation before native dispatch prevents publication, afterwards the call drains to the real
       * receipt. This is a versioned export artifact, not a backup, transcript or prompt. May sync. */
      context: {
        capture(
          selector: import("@read-aware/core").ContextBundleSelector,
          options?: PluginCallOptions,
        ): Promise<import("@read-aware/core").ContextBundleCaptureReceipt>;
      };
      /** Replace the event-backed summary using the observed profile2 revision.
       * Present the complete candidate for user confirmation before calling.
       * Empty text clears the summary, not memories or historical copies. */
      updateProfile(
        input: import("@read-aware/core").UserProfileChange,
      ): Promise<import("@read-aware/core").UserProfileReceipt>;
      /** Memory 2.5: confirm the full summary AND seeds before calling. Reuse the same
       * owner-local submissionId and exact candidate after a lost receipt; a different
       * candidate requires a new id and renewed confirmation. Atomic, event-backed. */
      completeOnboarding(
        input: import("@read-aware/core").OnboardingChange,
        options?: PluginCallOptions,
      ): Promise<import("@read-aware/core").OnboardingReceipt>;
      mutate(
        input: import("@read-aware/core").MemoryMutation,
      ): Promise<import("@read-aware/core").MemoryMutationReceipt>;
      classify(
        input: import("@read-aware/core").BookClassificationChange,
      ): Promise<import("@read-aware/core").BookClassificationReceipt>;
      startGraphTask(
        bookId: string,
        mode: "catch-up" | "rebuild",
        options?: import("@read-aware/core").BookGraphTaskOptions,
      ): Promise<import("@read-aware/core").BookGraphTaskSnapshot>;
      cancelGraphTask(bookId: string, taskId: string): Promise<import("@read-aware/core").BookGraphTaskSnapshot>;
      retryGraphTask(
        bookId: string,
        taskId: string,
        options?: import("@read-aware/core").BookGraphTaskOptions,
      ): Promise<import("@read-aware/core").BookGraphTaskSnapshot>;
    };
    events: {
      /** Initial snapshot, then changed results/errors; bounded polling, not an event log.
       * Plugins 1.5 supplies a separate reaction delivery, including graph task updates. */
      observe(
        query: import("@read-aware/core").MemoryObservationQuery,
        handler: PluginObservationHandler<import("@read-aware/core").MemoryObservation>,
      ): PluginDisposable;
    };
  };
  settings: PluginSettingsDomain;
};

// ─── Context handed to activate() ────────────────────────────────────────────

/** Persisted payload bytes, excluding identifiers, indexes, SQLite allocation,
 * reserved host document collections and encrypted credential values. */
export type PluginStorageUsage = {
  kv: { items: number; valueBytes: number };
  documents: { items: number; valueBytes: number };
  assets: { items: number; valueBytes: number };
};
export type PluginStoragePolicy = {
  usage: PluginStorageUsage;
  kv: {
    roaming: "preference-events";
    localOnlyKeys: string[];
    backup: "complete";
    uninstall: "retain";
    maxBytes: null;
  };
  documents: {
    roaming: "none";
    backup: "complete";
    uninstall: "delete";
    maxBytes: null;
    putMaxDocumentBytes: null;
    applyMaxDocumentBytes: number;
    applyMaxBatchBytes: number;
    applyMaxChanges: number;
  };
  secrets: { roaming: "none"; backup: "excluded"; uninstall: "retain"; maxBytes: null; usage: null };
  assets: {
    roaming: "none";
    backup: "complete";
    uninstall: "delete";
    maxBytes: number;
    maxItems: number;
    maxItemBytes: number;
  };
  /** Eligibility is not delivery: this query does not inspect remote sync. */
  syncStatus: "not-measured";
};

export type PluginStorage = {
  /** Storage 2.5: own persisted usage and actual per-store policy. Null quota
   * means no enforced total limit, not unlimited disk. Call flush first when
   * awaiting this activation's pending writes. No names or secret values.
   * Complete backup refers to full app backup, not reading/OPML exports. */
  policy(): Promise<PluginStoragePolicy>;
  get<T = unknown>(key: string): T | null;
  /** 2.4: keys up to 1024 UTF-16 units, no NUL. Settle accepted writes, then read this private key from SQLite, not
   * the optimistic mirror. Corrupt JSON rejects; null means absent or JSON null. */
  getDurable<T = unknown>(key: string): Promise<T | null>;
  /** Reads update optimistically; resolve only after the write is durable. */
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  /** Wait for outstanding writes in this plugin's namespace. */
  flush(): Promise<void>;
  /**
   * A named document collection — structured plugin-private data one tier
   * above the KV (queryable, per-document, optionally book-anchored). Backed
   * by the app's local store; lifecycle belongs to the plugin (uninstall
   * clears it). `bookId`/`anchor` are provenance INDEXES, not ownership —
   * documents survive the referenced book's deletion.
   */
  collection(name: string): PluginDocumentCollection;
  /** Storage 2.1: atomically compare and apply 1..100 private document changes.
   * Every expected revision is checked before any write. Does not include KV,
   * core domain events, files, or another plugin's documents. */
  applyDocuments(changes: PluginDocumentChange[]): Promise<PluginDocumentCommit>;
  /** Storage 2.2: initial and changed private document query snapshots, including
   * errors/recovery. At most 64 active observers per activation; reads and
   * callbacks settle before the next one-second poll. Not a replayable write
   * stream. Dispose or plugin retirement stops delivery; sequence is not CAS. */
  observeDocuments<T = unknown>(
    query: PluginDocumentObservationQuery,
    handler: PluginObservationHandler<PluginDocumentObservation<T>>,
  ): PluginDisposable;
  /**
   * Fires when this plugin's namespace is written from OUTSIDE the plugin —
   * its settings page, the reading agent, another surface editing the same
   * object. Settings-key changes can also echo after own writes. Serial callbacks
   * receive a reaction credential; use withEvent to preserve causes. No initial
   * callback; intermediate changes coalesce. Use it
   * to re-read (or re-derive from) settings you would otherwise have cached
   * at activate().
   */
  onChange(handler: PluginObservationHandler<{ kind: "changed" }>, options?: { ruleId?: string }): PluginDisposable;
};

export type PluginMigrationStorage = Omit<PluginStorage, "onChange" | "observeDocuments" | "policy">;

export type PluginLifecyclePhase = "activating" | "migrating" | "active";

export type PluginMigration = {
  fromVersion: number;
  toVersion: number;
  direction: "upgrade" | "downgrade";
};

export type PluginMigrationContext = {
  readonly manifest: Readonly<PluginManifest>;
  readonly lifecycle: { readonly phase: "migrating" };
  readonly storage: PluginMigrationStorage;
  /** Logging 1.0: own structured diagnostics only; no access to other services. */
  readonly logging: PluginLoggingService;
};

export type PluginExportFile = {
  /** Suggested basename shown by the host save dialog. */
  filename: string;
  /**
   * UTF-8 text (CSV, JSON, Markdown, …) or raw bytes for binary formats
   * (.apkg, images, EPUB, …).
   */
  content: string | Uint8Array | ArrayBuffer;
  mimeType?: string;
};

export type PluginDocument<T = unknown> = {
  id: string;
  data: T;
  bookId?: string;
  anchor?: string;
  /** ISO timestamp of the last write. */
  updatedAt: string;
  /** Storage 2.1: opaque local write identity, including same-value writes. */
  revision: string;
};

export type PluginDocumentChange = {
  collection: string;
  id: string;
  /** null requires absence; a revision requires that exact existing write. */
  expectedRevision: string | null;
} & ({ kind: "put"; data: unknown; bookId?: string; anchor?: string } | { kind: "delete" } | { kind: "check" });

export type PluginDocumentCommit =
  | { status: "conflict"; index: number }
  | { status: "applied"; documents: Array<{ collection: string; id: string; revision: string | null }> };

export type PluginDocumentPage<T = unknown> =
  | { status: "stale-cursor" }
  | { status: "ready"; items: PluginDocument<T>[]; nextCursor: string | null };

export type PluginDocumentPageFilter = {
  bookId?: string;
  limit?: number;
  oldestFirst?: boolean;
  cursor?: string;
  /** Storage 2.3: literal substring of any JSON key/scalar value, including
   * nested arrays/objects. Unicode lowercase matching, no tokenization,
   * regex, accent folding or metadata search. Trimmed empty means no filter.
   * Max 1024 UTF-8 bytes, no control characters. Search precedes pagination;
   * cursors bind the normalized query. Also supported by observeDocuments. */
  query?: string;
};
export type PluginDocumentObservationQuery = { collection: string } & (
  | { kind: "get"; id: string }
  | { kind: "page"; filter?: PluginDocumentPageFilter }
);
export type PluginDocumentObservationResult<T = unknown> =
  | { kind: "get"; document: PluginDocument<T> | null }
  | { kind: "page"; page: PluginDocumentPage<T> };
export type PluginDocumentObservation<T = unknown> = { sequence: number } & (
  | { status: "ready"; result: PluginDocumentObservationResult<T> }
  | { status: "error"; errorCode: string }
);

export type PluginDocumentCollection = {
  put(id: string, data: unknown, options?: { bookId?: string; anchor?: string }): Promise<void>;
  get<T = unknown>(id: string): Promise<PluginDocument<T> | null>;
  delete(id: string): Promise<void>;
  /** Newest-first by default. */
  list<T = unknown>(filter?: { bookId?: string; limit?: number; oldestFirst?: boolean }): Promise<PluginDocument<T>[]>;
  /** Storage 2.1: 1..200 rows (default 50), 4 MiB JSON per page.
   * Cursors bind namespace/filter/order and expire on any collection write.
   * On stale-cursor restart rather than combining different snapshots. */
  page<T = unknown>(filter?: PluginDocumentPageFilter): Promise<PluginDocumentPage<T>>;
};

export type PluginAgentScope = { kind: "global"; threadId: string } | { kind: "book"; bookId: string };

export type PluginAgentContextBlock = {
  title?: string;
  content: string;
};

export type PluginAgentContextProvider = {
  id: string;
  contexts?: Array<PluginAgentScope["kind"]>;
  /** 1.1: explicit durable intention source for context bundles, not prompt text.
   * Preparation settles migrations/writes; read must use committed storage and
   * must not generate text or return an optimistic cache. */
  readingIntent?: {
    scopes: Array<"user" | "book">;
    prepare(scope: import("@read-aware/core").ReadingIntentScope): Promise<void>;
    read(
      scope: import("@read-aware/core").ReadingIntentScope,
    ): Promise<import("@read-aware/core").ReadingIntentSnapshot>;
  };
  provide(input: {
    scope: PluginAgentScope;
    userText: string;
  }): PluginAgentContextBlock[] | Promise<PluginAgentContextBlock[]>;
};

export type PluginAgentRetrievalItem = {
  title?: string;
  content: string;
  location?: string;
};

export type PluginAgentRetrievalProvider = {
  id: string;
  label: string;
  description: string;
  contexts?: Array<PluginAgentScope["kind"]>;
  retrieve(input: {
    scope: PluginAgentScope;
    query: string;
    limit: number;
  }): PluginAgentRetrievalItem[] | Promise<PluginAgentRetrievalItem[]>;
};

export type PluginMemoryCandidate = {
  scope: "user" | "global" | "book";
  kind: "fact" | "preference" | "insight" | "summary";
  content: string;
};

export type PluginMemoryCandidateReceipt = import("@read-aware/core").MemoryCandidateReceipt;

export type PluginMemoryCandidateProvider = {
  id: string;
  contexts?: Array<PluginAgentScope["kind"]>;
  propose(input: {
    requestId: string;
    scope: PluginAgentScope;
    userText: string;
    assistantText: string;
  }): PluginMemoryCandidate[] | Promise<PluginMemoryCandidate[]>;
  /** Best-effort, once per settled proposal batch while this registration is active.
   * Saved means the host write succeeded, not that memory will never be changed.
   * No callback is guaranteed after retirement, process exit, or a failed propose.
   */
  onResult?(receipt: PluginMemoryCandidateReceipt): void | Promise<void>;
};

// ─── Sync transports (`sync:transport`) ──────────────────────────────────────
//
// A sync transport is a remote CIPHERTEXT mailbox: the host's sync engine
// seals every event and blob before it reaches the plugin and opens them only
// after they come back, so a transport never sees event types, payloads, book
// bytes, or keys — only opaque envelopes and their routing fields (event id +
// HLC stamp). What the plugin owns is purely "where the remote is and how to
// talk to it" (WebDAV, S3, …); ordering, merge, cursors, and crypto stay
// host-side.
//
// Remote layout contract (the host's feed adapter depends on it):
//
//  - **Event batches are per-device and dense.** Device `d`'s batches are
//    numbered 0..N-1 with no holes; a device only ever appends batch N after
//    batch N-1 exists. `listEventBatches` reports each device's batch count;
//    `getEventBatch` returns one batch verbatim. Batches are immutable once
//    written.
//  - **Blobs mirror the relay's envelope formats** (v1 whole / v2 descriptor
//    + parts): `putBlob`/`getBlob` move the main object, `putBlobPart` stages
//    one sealed part, `commitBlob` must verify all parts exist and then write
//    the descriptor the engine reads back via `getBlob`.
//  - **Meta objects** are small named files next to the data (key material,
//    markers). `putMetaIfAbsent` must be create-only: when the object already
//    exists it reports `"exists"` and leaves it untouched — that is the
//    first-writer-wins ritual two devices use to agree on key material.
//
// Failure vocabulary: throw errors carrying a stable `code` property from the
// `sync/*` family where the cause is known — `sync/quota` and
// `sync/file-too-large` mark a blob as permanently rejected instead of
// retried, `sync/unauthorized` and `sync/network` drive the status surfaces'
// copy. Uncoded errors are treated as transient and retried with backoff.

/** One device's dense batch range as the remote currently holds it. */
export type PluginSyncBatchListing = Array<{ deviceId: string; count: number }>;

/**
 * A live connection to one remote mailbox, produced by `open()` from the
 * plugin's current settings. All methods may be called repeatedly and
 * concurrently within one session.
 */
export type PluginSyncTransportSession = {
  /**
   * Stable identity of the remote mailbox (derive it from the normalized
   * endpoint + account + base path). The host binds the local push/pull
   * bookkeeping to it: a different `endpointId` after connect means "this is
   * another mailbox" and sync refuses until the user reconnects.
   */
  endpointId: string;
  /** Idempotently stop this session, abort its work and release its resources.
   * After close starts, no new operation may start. Already committed remote
   * effects are not undone. The host releases callback handles after closing. */
  close(): Promise<void>;
  /** Cheap reachability + credential check; used by the connect flow. */
  probe(): Promise<void>;
  /** Read a named meta object; null when it does not exist. */
  getMeta(name: string): Promise<Uint8Array | null>;
  /** Create-only write: `"exists"` (leaving the remote untouched) when the
   *  object is already there — first writer wins. */
  putMetaIfAbsent(name: string, bytes: Uint8Array): Promise<"stored" | "exists">;
  listEventBatches(): Promise<PluginSyncBatchListing>;
  getEventBatch(deviceId: string, index: number): Promise<SealedEventWire[]>;
  /** Append one immutable batch; must fail rather than overwrite an existing
   *  index. */
  putEventBatch(deviceId: string, index: number, events: SealedEventWire[]): Promise<void>;
  putBlob(key: string, bytes: Uint8Array): Promise<void>;
  getBlob(key: string): Promise<Uint8Array | null>;
  putBlobPart(key: string, index: number, parts: number, bytes: Uint8Array): Promise<void>;
  commitBlob(key: string, parts: number): Promise<void>;
  getBlobPart(key: string, index: number): Promise<Uint8Array>;
};

export type PluginSyncTransport = {
  /** Unique within the plugin. */
  id: string;
  /** Backend name shown in Settings → Data & Sync (e.g. "WebDAV"). */
  label: PluginText;
  /**
   * Build a session from the plugin's CURRENT settings. Must not touch the
   * network (that is `probe`'s job); throw a descriptive error when required
   * settings are missing.
   */
  open(): Promise<PluginSyncTransportSession>;
};

/** readaware://plugin/<pluginId>/<handlerId>?key=value, delivered only after
 * host confirmation. Namespaces cannot intercept login/billing/system links.
 * Link parameters are untrusted input, never authorization or secret grants. */
export type PluginUriRequest = { parameters: { key: string; value: string }[] };
export type PluginUriHandler = {
  id: string;
  state?: PluginActionState;
  open(request: PluginUriRequest): PluginViewResult | Promise<PluginViewResult>;
};

/** Runtime theme images are owned private assets, never URLs or CSS. The host
 * decodes a bounded raster copy. Only selecting this theme applies it. */
export type PluginRuntimeTheme = PluginThemeContribution & {
  readerBackground?: {
    assetKey: string;
    assetRevision: string;
    /** 0 = invisible, 1 = opaque. */
    opacity: number;
    /** Black overlay on the image only: 0 = unchanged, 1 = black. */
    dim: number;
  };
};

export type PluginContributions = {
  /** Themes 1.1: staged, activation-owned themes; replacing an id replaces its
   * image too. Invalid/missing assets reject before replacing the live theme. */
  themes?: {
    register(theme: PluginRuntimeTheme): Promise<PluginDisposable>;
  };
  uriHandlers: {
    register(handler: PluginUriHandler): PluginActionRegistration;
  };
  selectionActions: {
    register(action: PluginSelectionAction): PluginActionRegistration;
  };
  headerActions: {
    register(action: PluginHeaderAction): PluginActionRegistration;
  };
  contextActions: {
    register(action: PluginContextAction): PluginActionRegistration;
  };
  commands: {
    register(command: PluginCommand): PluginActionRegistration;
  };
  settingsOptions: {
    register(
      fieldId: string,
      provider: (values: PluginFormValues) => PluginSelectOption[] | Promise<PluginSelectOption[]>,
    ): PluginDisposable;
  };
  voiceProviders: {
    register(provider: PluginVoiceProvider): PluginDisposable;
  };
  contentProviders: {
    register(provider: { id: string; load(key: string): Promise<PluginBookContent> }): PluginDisposable;
  };
  readerModes?: {
    register(mode: PluginReaderMode): PluginDisposable;
  };
  agentTools?: {
    register(tool: PluginToolDefinition): PluginActionRegistration;
  };
  agentContextProviders?: {
    register(provider: PluginAgentContextProvider): PluginDisposable;
  };
  agentRetrievalProviders?: {
    register(provider: PluginAgentRetrievalProvider): PluginDisposable;
  };
  memoryCandidateProviders?: {
    register(provider: PluginMemoryCandidateProvider): PluginDisposable;
  };
  syncTransports?: {
    register(transport: PluginSyncTransport): PluginDisposable;
  };
};

export type PluginLogEntry = {
  level: "debug" | "info" | "warn" | "error";
  /** Stable developer event name, never user content, a URL, a path or a secret. */
  event: string;
  /** Stable machine-readable failure code, not error.message or stack. */
  errorCode?: string;
  /** Up to 12 numeric/boolean measurements; no text, arrays or nested objects. */
  fields?: Record<string, number | boolean>;
};

export type PluginLogReceipt =
  | { status: "accepted" }
  | { status: "disabled" }
  | { status: "rate-limited"; retryAfterMs: number };

export type PluginLoggingService = {
  /** Logging 1.0: accepted means forwarded to the best-effort host logger,
   * not durably stored or uploaded. Allowed during activation and migration.
   * Debug is development-console-only. Retired activations cannot write. */
  write(entry: PluginLogEntry): Promise<PluginLogReceipt>;
  policy(): Promise<{
    levels: PluginLogEntry["level"][];
    maxEntryChars: number;
    maxFields: number;
    perPluginLimit: number;
    appLimit: number;
    windowMs: number;
    delivery: "best-effort";
  }>;
};

export type PluginInferenceInput = {
  prompt: string;
  /** llm 1.5: up to four sealed image resource IDs owned by this activation.
   * Native PNG decode, 8 MiB each/16 MiB total; original-book/context exports rejected.
   * Sends pixels to the selected vision-capable model, never URLs or arbitrary bytes. */
  images?: { resourceId: string }[];
  /** llm 1.4: optional caller-generated ID (1..64 ASCII letters/digits/_/-).
   * Retains metadata independently of the cancellable RPC. IDs must be unique
   * among retained requests; this is not a retry/idempotency key. */
  requestId?: string;
  system?: string;
  model?: "fast" | "smart";
  /** Keep book fragments here: host privacy filtering and live revocation apply. */
  readingContext?: import("@read-aware/core").ModelReadingContext;
  /** Cancellation reaches host inference; no remote rollback guarantee. */
  signal?: AbortSignal;
  /** Integer milliseconds, 1..110000, default 60000; covers structured retries. */
  timeoutMs?: number;
  /** llm 1.3: positive integer <= 65536, requested separately for each attempt.
   * Model/account/provider limits may be stricter. Omit to retain account defaults.
   * This is not a total token/cost budget or a guarantee of provider compliance. */
  maxOutputTokens?: number;
  /** llm 1.6: total requested output-token budget across structured retries, 1..131072.
   * Unknown/zero output usage consumes that attempt's full reservation. Provider billing may differ. */
  maxTotalOutputTokens?: number;
  /** llm 1.6: aggregate UTF-16 output across attempts/stream deltas, 1..262144 (default).
   * Text input including schema/retry feedback is limited to 262144 UTF-16 units per attempt. */
  maxOutputChars?: number;
};

export type PluginHostServices = {
  storage: PluginStorage;
  logging: PluginLoggingService;
  secrets: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  ui: {
    /** UI 1.11: main-window metadata and explicit user intents. No close, paths, title or arbitrary windows. */
    window?: {
      snapshot(): Promise<import("@read-aware/core").HostWindowSnapshot>;
      /** UI 1.17: reaction delivery remains valid until the callback settles. */
      observe(
        handler: PluginObservationHandler<import("@read-aware/core").HostWindowObservation>,
        options?: { ruleId?: string },
      ): PluginDisposable;
      control(
        request: import("@read-aware/core").HostWindowRequest,
      ): Promise<import("@read-aware/core").HostWindowReceipt>;
    };
    /** UI 1.4: native navigation/shelf commands. UI 1.5: typed open-book/open-collection args. Never arbitrary menu/plugin IDs. */
    commands?: {
      list(): Promise<import("@read-aware/core").HostCommandSnapshot>;
      /** UI 1.16: serial/coalesced snapshots with a reaction delivery and optional stable ruleId. */
      observe(
        handler: PluginObservationHandler<import("@read-aware/core").HostCommandObservation>,
        options?: { ruleId?: string },
      ): PluginDisposable;
      /** Library write plus each command's setting grant; opening/leaving a reader needs reading:write. */
      execute?(
        request: import("@read-aware/core").HostCommandRequest,
      ): Promise<import("@read-aware/core").HostCommandReceipt>;
    };
    /** UI 1.15: library read grants expose a workspace projection. Book-restricted
     * projections filter selection before pagination/counting, explicitly mark
     * withheld collection/search fields, and retain an actor-local concurrency
     * token. Collection-wide navigation requires all-books access; supplied
     * selections/open-book commands must name only the authorized book. */
    workspace?: {
      snapshot(
        query?: import("@read-aware/core").WorkspaceQuery,
      ): Promise<import("@read-aware/core").WorkspaceSnapshot>;
      /** UI 1.16: use the separate reaction delivery even for null/retired snapshots. */
      observe(
        query: import("@read-aware/core").WorkspaceQuery,
        handler: PluginObservationHandler<import("@read-aware/core").WorkspaceSnapshot | null>,
        options?: { ruleId?: string },
      ): PluginDisposable;
      /** Library write grant; leaving an active reader additionally requires reading:write. */
      navigate?(
        target: import("@read-aware/core").WorkspaceTarget,
        expectedRevision?: number,
      ): Promise<import("@read-aware/core").WorkspaceReceipt>;
    };
    showToast(message: PluginToast): void;
    exportFile(file: PluginExportFile): Promise<boolean>;
    /** UI 1.7, requires service:network. Explicit user intent only; HTTP(S), no credentials or local schemes. */
    openExternal?(url: string): Promise<void>;
    /** Updates only this activation's visible frame. Revision is a nonnegative, increasing safe integer.
     * Receipt confirms host acceptance, not paint; updates cannot navigate or replace the subscription. */
    publishView(channel: PluginViewChannel, update: PluginViewUpdate): Promise<PluginViewUpdateReceipt>;
    /** Requires reading:read (write includes read). No book content is returned. */
    reader?: {
      /** UI 1.12: already-open native image viewer. No URL, bytes, alt text or implicit opening. */
      image?: {
        snapshot(): Promise<import("@read-aware/core").ReaderImageSnapshot | null>;
        /** Plugins 1.6 supplies a separate reaction delivery, including closed/null snapshots. */
        observe(
          handler: PluginObservationHandler<import("@read-aware/core").ReaderImageSnapshot | null>,
        ): PluginDisposable;
        /** reading:write; exact current viewer ID required. Pan deltas are fractions of its viewport. */
        control?(
          request: import("@read-aware/core").ReaderImageRequest,
        ): Promise<import("@read-aware/core").ReaderImageReceipt>;
        /** UI 1.13: library read + reading write; opens an embedded image in the current book. */
        open?(
          query: import("@read-aware/core").BookImageQuery,
          guard?: import("@read-aware/core").ReadingSessionGuard,
        ): Promise<import("@read-aware/core").ReaderImageOpenReceipt>;
      };
      snapshot(): Promise<import("@read-aware/core").ReaderPanelsSnapshot | null>;
      /** Plugins 1.6 supplies a separate reaction delivery; callbacks are serial and coalesced. */
      observe(
        handler: PluginObservationHandler<import("@read-aware/core").ReaderPanelsSnapshot | null>,
      ): PluginDisposable;
      /** Requires reading:write. Opening reveals controls; completion waits for persistence and DOM commit. */
      setPanel?(
        panel: import("@read-aware/core").ReaderPanel,
        open: boolean,
        guard?: import("@read-aware/core").ReadingSessionGuard,
      ): Promise<import("@read-aware/core").ReaderPanelReceipt>;
      /** Persist a shared TOC/chat width (integer 240..640 CSS px); does not open it or focus. */
      setWidth?(
        panel: import("@read-aware/core").ResizableReaderPanel,
        width: number,
        guard?: import("@read-aware/core").ReadingSessionGuard,
      ): Promise<import("@read-aware/core").ReaderPanelReceipt>;
      /** UI 1.14, reading:write. Focus an already visible semantic target, without opening or dismissing UI.
       * not-focused is not success; close your own dialog before returning focus. */
      focus?(
        target: import("@read-aware/core").ReaderFocusTarget,
        guard?: import("@read-aware/core").ReadingSessionGuard,
      ): Promise<import("@read-aware/core").ReaderFocusReceipt>;
      /** UI 1.8: also needs library:read. Open book only; resolved preview waits for DOM commit. */
      previewReference?(
        query: import("@read-aware/core").BookReferenceQuery,
        guard?: import("@read-aware/core").ReadingSessionGuard,
      ): Promise<import("@read-aware/core").ReaderReferencePreviewReceipt>;
      /** Only this activation's current preview ID; never closes a native or other owner's note. */
      closeReferencePreview?(id: string): Promise<import("@read-aware/core").ReaderReferenceCloseReceipt>;
    };
  };
  schedules: {
    bind(
      scheduleId: string,
      run: (
        context: import("@read-aware/core").PluginScheduleRun,
        delivery?: PluginReactionEvent,
      ) => void | Promise<void>,
    ): PluginDisposable;
    /** Schedules 2: enqueue one declared deferred task. Persists before acknowledgement.
     * 1 second..7 days; idle means 5 seconds without host input. Never runs while closed.
     * The most recent request ID is retained for retry; changed input conflicts, another queued ID is busy.
     * A dispatched request is never automatically replayed after a crash. Inspect interrupted and decide explicitly. */
    defer(
      id: string,
      input: import("@read-aware/core").PluginDeferredRequest,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").PluginDeferredReceipt>;
    /** Cancel exactly the queued ID, not an in-flight callback or a replacement request. */
    cancelDeferred(
      id: string,
      requestId: string,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").PluginDeferredReceipt>;
    /** Bound schedules owned by this plugin only, with the latest persisted attempt/outcome. */
    list(
      query?: Omit<import("@read-aware/core").PluginScheduleQuery, "pluginId">,
    ): Promise<import("@read-aware/core").PluginSchedulePage>;
    observe(
      query: Omit<import("@read-aware/core").PluginScheduleQuery, "pluginId">,
      handler: PluginObservationHandler<import("@read-aware/core").PluginSchedulePage>,
      options?: { ruleId?: string },
    ): PluginDisposable;
    /** Pause/resume persist; run bypasses pause/cadence once. Neither pause nor cancellation undoes dispatched callback effects. */
    control(id: string, action: "pause" | "resume" | "run"): Promise<import("@read-aware/core").PluginScheduleReceipt>;
  };
  plugins: {
    /** Plugins 1.8: authorized service contracts; discovery does not execute providers. */
    listServices(
      query?: import("@read-aware/core").PluginServiceQuery,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").PluginServicePage>;
    /** Executes one declared export in a fresh restricted Worker. No live-root closures,
     * callbacks, binary handles, automatic retries, or resources surviving the call. */
    callService(
      request: import("@read-aware/core").PluginServiceCall,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").PluginServiceReceipt>;
    /** Registered identities across extension points, never provider callbacks,
     * data, settings or a grant to invoke another plugin. Offset pages may change. */
    contributions(
      query?: import("@read-aware/core").PluginContributionQuery,
    ): Promise<import("@read-aware/core").PluginContributionPage>;
    observeContributions(
      query: import("@read-aware/core").PluginContributionQuery,
      handler: PluginObservationHandler<import("@read-aware/core").PluginContributionPage>,
      options?: { ruleId?: string },
    ): PluginDisposable;
    /** Public installed metadata only, no settings, paths, secrets or raw errors. */
    list(
      query?: import("@read-aware/core").PluginDirectoryQuery,
    ): Promise<import("@read-aware/core").PluginDirectoryPage>;
    /** Plugins 1.10: serial reaction deliveries with stable rule IDs; reload offset pages after changes. */
    observe(
      query: import("@read-aware/core").PluginDirectoryQuery,
      handler: PluginObservationHandler<import("@read-aware/core").PluginDirectoryPage>,
      options?: { ruleId?: string },
    ): PluginDisposable;
  };
  maintenance: {
    /** Maintenance 1.3: reveal native AI test controls; only the user's click starts inference. */
    requestConnectionTest(options?: PluginCallOptions): Promise<import("@read-aware/core").ConnectionTestReceipt>;
    /** Reveals a host backup button and awaits the user's click and file dialog.
     * Both directions use the complete encrypted archive (host-only password);
     * import adds host review and confirmation, then reload. Retired v1 JSON
     * library backups are rejected. No passwords, bytes or paths are returned. */
    requestBackup(
      action: import("@read-aware/core").BackupAction,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").BackupReceipt>;
    snapshot(): Promise<import("@read-aware/core").HostMaintenanceSnapshot>;
    observe(
      handler: PluginObservationHandler<import("@read-aware/core").HostMaintenanceSnapshot>,
      options?: { ruleId?: string },
    ): PluginDisposable;
    /** Reveals the host's controls only; export/send/install still require native user actions. */
    /** Maintenance 1.4 adds data-location: shows the directory in host UI, never returns its path or opens the file manager.
     * Also reveals updates/diagnostics/plugins/backup-import/backup-export/delete-data/ai-connection.
     * Does not click controls, open file dialogs, approve installation or bypass typed DELETE. */
    openSettings(
      surface: import("@read-aware/core").HostMaintenanceSurface,
    ): ReturnType<import("@read-aware/core").HostMaintenancePort["openSettings"]>;
    /** Requires service:network. Uses the host release feed; no caller-supplied URL or silent installation. */
    checkForUpdates?(): Promise<import("@read-aware/core").HostMaintenanceSnapshot>;
  };
  /** Requires service:diagnostics. Counts or host-confirmed report outcomes only. */
  diagnostics?: {
    /** Diagnostics 1.2: opens host confirmation; a committed repair requires reload. */
    requestProjectionRepair(options?: PluginCallOptions): Promise<import("@read-aware/core").ProjectionRepairReceipt>;
    requestReport(
      action: import("@read-aware/core").DiagnosticsReportAction,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").DiagnosticsReportReceipt>;
    verifyProjections(options?: PluginCallOptions): Promise<import("@read-aware/core").ProjectionVerification>;
  };
  resources: {
    /** Resources 1.4: reader-selected, read-only directory grants; four per activation, one hour.
     * No ambient paths. Listings are live; openDirectoryFile seals the current file bytes. */
    pickDirectory(): Promise<{ cancelled: boolean; directory: import("@read-aware/core").ResourceDirectoryRef | null }>;
    listDirectory(
      id: string,
      query?: import("@read-aware/core").ResourceDirectoryQuery,
    ): Promise<import("@read-aware/core").ResourceDirectoryPage>;
    openDirectoryFile(id: string, relativePath: string): Promise<import("@read-aware/core").ResourceRef>;
    releaseDirectory(id: string): Promise<void>;
    /** Resources 1.3: own local binary assets, retained across activations.
     * Only full backups include them; uninstall deletes them. No sync. */
    assets: {
      policy(options?: PluginCallOptions): Promise<import("@read-aware/core").PluginAssetPolicy>;
      list(
        query?: import("@read-aware/core").PluginAssetQuery,
        options?: PluginCallOptions,
      ): Promise<import("@read-aware/core").PluginAssetPage>;
      get(key: string, options?: PluginCallOptions): Promise<import("@read-aware/core").PluginAsset | null>;
      store(
        resourceId: string,
        input: import("@read-aware/core").PluginAssetWrite,
        options?: PluginCallOptions,
      ): Promise<import("@read-aware/core").PluginAssetReceipt>;
      open(
        key: string,
        expectedRevision: string,
        options?: PluginCallOptions,
      ): Promise<import("@read-aware/core").ResourceRef>;
      delete(
        key: string,
        expectedRevision: string,
        options?: PluginCallOptions,
      ): Promise<{ deleted: true; cleanupPending: boolean }>;
    };
    pick(
      options?: import("@read-aware/core").ResourcePickOptions,
    ): Promise<{ cancelled: boolean; resources: import("@read-aware/core").ResourceRef[] }>;
    /** Requires library:read. Original local file only; no implicit remote download. */
    openBook?(bookId: string): Promise<import("@read-aware/core").ResourceRef | null>;
    /** Resources 1.1; requires library:read. No extraction/download when the cover is unavailable. */
    openCover?(bookId: string): Promise<import("@read-aware/core").ResourceRef | null>;
    create(options: import("@read-aware/core").ResourceCreateOptions): Promise<import("@read-aware/core").ResourceRef>;
    stat(id: string): Promise<import("@read-aware/core").ResourceRef>;
    read(id: string, offset: number, length: number): Promise<import("@read-aware/core").ResourceChunk>;
    append(id: string, offset: number, data: Uint8Array | ArrayBuffer): Promise<import("@read-aware/core").ResourceRef>;
    commit(id: string): Promise<import("@read-aware/core").ResourceRef>;
    save(id: string, filename?: string): Promise<{ saved: boolean }>;
    /** Resources 1.5: host confirmation then OS association for a temporary document/media copy.
     * No edit-back, arbitrary program/path, or context bundles. True is dispatch, not rendering. */
    openAssociated(id: string, options?: PluginCallOptions): Promise<{ opened: boolean }>;
    /** Also aborts uncommitted writes. */
    release(id: string): Promise<void>;
  };
  /** Requires service:sync; no keys, account identifiers, billing tickets or raw event access. */
  sync?: Omit<
    import("@read-aware/core").HostSyncPort,
    "backlog" | "account" | "requestSync" | "openSettings" | "requestFlow"
  > & {
    /** Events and blobs waiting to be pushed. */
    backlog(): ReturnType<import("@read-aware/core").HostSyncPort["backlog"]>;
    /** Explicit remote read of the account's tier, usage and limits; null without an account.
     * No email, account ID, keys, session or billing ticket. */
    account(): ReturnType<import("@read-aware/core").HostSyncPort["account"]>;
    /** Runs one sync round on the configured backend (relay or a transport plugin such as
     * WebDAV) and resolves when it has finished: `completed`, or `already-running` when a
     * round was in progress (not queued again). Rejects with a coded error when no round can
     * start (`ui/unavailable`) or the round fails (classified failures carry `sync/*` codes). */
    requestSync(): ReturnType<import("@read-aware/core").HostSyncPort["requestSync"]>;
    /** Opens the host Data & Sync page; not a login, disconnect or purchase. */
    openSettings(): ReturnType<import("@read-aware/core").HostSyncPort["openSettings"]>;
    /** Host-owned connect, disconnect, account deletion, upgrade or billing flow. Waits for the
     * final local outcome or external handoff; cancellation cannot undo a started operation. */
    requestFlow(
      request: import("@read-aware/core").HostSyncFlowRequest,
      options?: PluginCallOptions,
    ): ReturnType<import("@read-aware/core").HostSyncPort["requestFlow"]>;
    /** Delivers each new sync snapshot (state, progress, completed cycles) while the handle lives. */
    observe(
      handler: PluginObservationHandler<import("@read-aware/core").HostSyncSnapshot>,
      options?: { ruleId?: string },
    ): PluginDisposable;
  };
  /** Persistent scoped reload hints, available under the existing read grants. */
  changes: {
    /** Open before loading a baseline. Persist the returned cursor only after
     * processing each page. Expired cursors require a new baseline. Notices are
     * conservative reload hints, not events or values; settings hints cover the
     * authorized requested paths in a shared storage namespace. */
    open(query: import("@read-aware/core").ChangesQuery, options?: PluginCallOptions): Promise<{ cursor: string }>;
    read(
      query: import("@read-aware/core").ChangesQuery,
      cursor: string,
      limit?: number,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").ChangesPage>;
  };
  jobs: {
    /** jobs 1.1: event-bound starts preserve their source through restart. Every
     * causal event subscription must have a stable ruleId. Unnamed reactions
     * and isolated service invocations cannot create saved jobs. */
    start(
      plan: import("@read-aware/core").DurableJobPlan,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").DurableJobSnapshot>;
    get(id: string, options?: PluginCallOptions): Promise<import("@read-aware/core").DurableJobSnapshot>;
    list(
      query?: { offset?: number; limit?: number },
      options?: PluginCallOptions,
    ): Promise<{ jobs: import("@read-aware/core").DurableJobSnapshot[]; nextOffset: number | null }>;
    control(
      id: string,
      action: import("@read-aware/core").DurableJobControl,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").DurableJobSnapshot>;
  };
  /** Local semantic transactions. Preview does not execute; commit consumes the
   * frozen preview once. Query the receipt after an unknown response before retrying. */
  transactions: {
    preview(
      operations: import("@read-aware/core").AtomicOperation[],
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").AtomicPreview>;
    commit(previewId: string, options?: PluginCallOptions): Promise<import("@read-aware/core").AtomicReceipt>;
    previewUndo(receiptId: string, options?: PluginCallOptions): Promise<import("@read-aware/core").AtomicPreview>;
    receipt(receiptId: string, options?: PluginCallOptions): Promise<import("@read-aware/core").AtomicReceipt | null>;
  };
  session: {
    /** Session 2.11: inspect host command permissions/workspace guards and plugin service contract/authority/capacity (Agent approval remains required), export metadata/save entry and clipboard/browser entry availability (no OS access probe), window support/capacity/target state, sync connection/credentials/provider, inference, book-targeted playback/mode, text preparation and graph prerequisites without executing
     * or probing. Missing permission returns only the permission condition.
     * Unknown remote health is not a local refusal or a success guarantee. */
    operationAvailability(
      query: import("@read-aware/core").OperationAvailabilityQuery,
      options?: PluginCallOptions,
    ): Promise<import("@read-aware/core").OperationAvailability>;
    /** Fresh non-sensitive metadata; contains no reading or account state. */
    environment(): Promise<import("@read-aware/core").HostEnvironmentSnapshot>;
    /** Delivers an initial snapshot, then changed revisions. Disposed on unload. */
    /** Session 2.7: locale effects retain their requester; other system facts keep independent sources. */
    observeEnvironment(
      handler: (
        snapshot: import("@read-aware/core").HostEnvironmentSnapshot,
        delivery?: PluginReactionEvent,
      ) => void | Promise<void>,
      options?: { ruleId?: string },
    ): PluginDisposable;
  };
  network?: {
    /** Network 2.0: this activation's immutable authorization and transport limits.
     * All-origins authorization is ["*"], not a guarantee of endpoint reachability. */
    policy(): Promise<
      PluginNetworkAccess & {
        maxRedirects: number;
        maxBodyBytes: number;
        timeoutMs: number;
        maxStreamBytes: number;
        maxChunkBytes: number;
        maxConcurrentRequests: number;
        maxHostConcurrentRequests: number;
        cumulative: {
          windowMs: number;
          maxOwnerRequests: number;
          maxHostRequests: number;
          maxOwnerBytes: number;
          maxHostBytes: number;
          maxOwners: number;
        };
        retry: { maxRetries: number; baseDelayMs: number; maxDelayMs: number; statuses: readonly number[] };
      }
    >;
    /** Native HTTP; Request/init semantics and cancellation survive the Worker bridge.
     * Bodies are buffered up to 64 MiB per direction. Calls have a 120s deadline;
     * an abort does not undo a remote side effect already committed by the server.
     * Network 2.0 requires networkAccess for the initial URL and each redirect.
     * HTTPS -> HTTP redirects are denied. At most 10 redirects; manual returns
     * the 3xx response, error rejects. Cross-origin hops drop authorization,
     * proxy-authorization, cookie and referer; custom secret headers are the
     * plugin's responsibility (use redirect:error for authenticated endpoints).
     * Host/content-length are transport-owned. No implicit retry or cookie jar.
     * Network 2.2: options.retry="safe" opts GET/HEAD without a body into at most
     * two retries across the whole redirect chain, before response headers are
     * returned. Other methods and all body reads are never replayed. The original
     * deadline includes backoff; Retry-After above 30s returns the HTTP response.
     * Attempts/uploads/read chunks share per-owner and host cumulative quotas;
     * reactivation does not reset owner debt. policy() reports exact limits.
     * Transport failures carry plugin/network-failed; explicit deadlines carry
     * plugin/network-timeout, aborts plugin/cancelled. Existing structured codes
     * survive unchanged. Unclassified native errors are not guessed from prose.
     * HTTP error statuses still return Response; the consumer decides success. */
    fetch(input: string | URL | Request, init?: RequestInit, options?: { retry?: "none" | "safe" }): Promise<Response>;
    /** Network 2.1: headers first; download at most 1 GiB without buffering the
     * whole response. Uploads remain capped at 64 MiB. 8 active requests per
     * activation / 32 host-wide, shared with fetch; no hidden durable queue.
     * Optional safe retry applies only before this opening receipt, as in fetch.
     * init.signal cancels OPENING only; after receipt use closeStream to cancel.
     * Close in finally if not reading to EOF. 120s absolute lifetime, including
     * headers/redirects/reads; unload cancels and drains native resources. */
    openStream(
      input: string | URL | Request,
      init?: RequestInit,
      options?: { retry?: "none" | "safe" },
    ): Promise<PluginNetworkStream>;
    /** Sequential, non-replayable reads. offset must equal bytes already delivered.
     * One outstanding read per stream; maxBytes defaults to 64 KiB, max 1 MiB.
     * A lost read receipt is not safely retryable: close and restart explicitly. */
    readStream(id: string, offset: number, maxBytes?: number): Promise<PluginNetworkChunk>;
    /** Idempotent for this activation's released/unknown IDs. Aborts pending reads;
     * does not undo remote effects or remove data already saved by the plugin. */
    closeStream(id: string): Promise<void>;
  };
  llm?: {
    /** Plugin inference limits, not billing quotas. maxOutputTokensLimit since 1.3. */
    policy(): Promise<{
      defaultTimeoutMs: number;
      maxTimeoutMs: number;
      perPluginLimit: number;
      appLimit: number;
      maxOutputTokensLimit: number;
      maxImageCount: number;
      maxImageBytes: number;
      maxImageTotalBytes: number;
      maxTotalOutputTokensLimit: number;
      maxOutputCharsLimit: number;
      maxInputChars: number;
    }>;
    ask(input: PluginInferenceInput & { schema?: never; onText?: (delta: string) => void }): Promise<string>;
    ask(input: PluginInferenceInput & { schema: Record<string, unknown>; onText?: never }): Promise<unknown>;
    /** llm 1.3: same execution as ask, with per-attempt metadata on success.
     * Includes structured retries; failure/cancellation rejects, not a billing receipt. */
    askDetailed(
      input: PluginInferenceInput & { schema?: never; onText?: (delta: string) => void },
    ): Promise<import("@read-aware/core").InferenceResult<string>>;
    askDetailed(
      input: PluginInferenceInput & { schema: Record<string, unknown>; onText?: never },
    ): Promise<import("@read-aware/core").InferenceResult>;
    /** llm 1.6: last 64 named requests in this plugin's local private storage.
     * Initial metadata commits before inference dispatch; no prompt/output is retained.
     * Includes backup/rollback and uninstall cleanup, not roaming or billing history.
     * requestAvailable identifies this activation's handle. An older unsettled record
     * has interrupted=true: status is last observed, not proof it still runs remotely.
     * No automatic retry/resume; historical IDs cannot control another activation.
     * Late terminal usage is persisted; unknown/evicted IDs return null. */
    getRequest(requestId: string): Promise<import("@read-aware/core").InferenceRequestReceipt | null>;
    listRequests(): Promise<import("@read-aware/core").InferenceRequestReceipt[]>;
    /** Requests cancellation independently of the ask RPC. The returned snapshot
     * may still be running; query again for its outcome and provider settlement. */
    cancelRequest(requestId: string): Promise<import("@read-aware/core").InferenceRequestReceipt | null>;
  };
  clipboard?: {
    writeText(text: string): Promise<void>;
    /** Clipboard 1.1. This activation's sealed resource; raster decode stays in the host. */
    writeImage(resourceId: string): Promise<import("@read-aware/core").ResourceImageReceipt>;
  };
};

/** The actor-scoped capability view handed to `activate()`. */
export type PluginContext = {
  /** Plugins 1.2: bind automatic follow-up calls to a delivered domain/settings
   * event. Use this context for every resulting operation, including after
   * await. Existing permissions, object grants, resources and task owners remain
   * unchanged. New calls after the callback settles are rejected; accepted work
   * retains its cause. A cycle token rejects operations with plugin/event-cycle.
   * Independent user actions use the original activation context. Plugins 1.3
   * also accepts the second callback argument from settings.observe,
   * library/conversations.observeInvalidation and storage.observeDocuments.
   * Plugins 1.4 adds annotations.events.observe, retaining causes through query
   * retries and remote/restore invalidation. The snapshot contains no token.
   * Plugins 1.5 also accepts memory.events.observe deliveries. */
  withEvent(event: PluginReactionEvent | undefined): PluginContext;
  /** Plugins 1.7: bind an existing contribution registration's updateState or
   * disposal to this delivery. Only handles owned by this activation are valid;
   * subscription/resource disposables are not contribution registrations.
   * Every operation rechecks the delivery lease. User actions use the original
   * handle, and automatic callbacks await the bound operation before returning. */
  withEvent<T extends PluginDisposable>(
    event: PluginReactionEvent | undefined,
    registration: T,
  ): PluginEventRegistration<T>;
  readonly manifest: Readonly<PluginManifest>;
  readonly appVersion: string;
  readonly locale: string;
  /** Stable identity shared by event-bound contexts from this activation. */
  readonly lifecycle: { readonly phase: PluginLifecyclePhase };
  /** Only capabilities visible to this plugin actor, with host-side versions. */
  readonly capabilities: Readonly<PluginCapabilityView>;
  /** The immutable object grant selected by the user for this activation. */
  readonly grants: Readonly<{ book: PluginBookAccess }>;
  domains: PluginDomains;
  contributions: PluginContributions;
  services: PluginHostServices;
};

/**
 * The default export of a plugin's entry module — `migrate` and `services` are
 * methods of this object, not named exports. It runs in a Worker with no DOM;
 * the JavaScript floor is Chrome 107 / Safari 16 with ES2024 built-ins
 * polyfilled. `Intl` APIs beyond that floor are whatever the system WebView
 * provides, so feature-test them.
 */
export type PluginModule = {
  activate(ctx: PluginContext): void | Promise<void>;
  /** Runs without activate(), in a fresh realm with intersected permissions/settings/
   * network and a host-fixed book grant. Return bounded JSON matching the manifest. */
  services?: Record<string, (ctx: PluginContext, input: unknown) => unknown | Promise<unknown>>;
  /** Runs with storage-only authority before a changed data schema is committed. */
  migrate?(ctx: PluginMigrationContext, migration: PluginMigration): void | Promise<void>;
  deactivate?(): void | Promise<void>;
};

export {
  searchAllBookLocations,
  type BookLocationSearchPageReader,
  type BookLocationSearchProgress,
  type BookLocationSearchRunStatus,
  type BookLocationSearchRun,
  type BookLocationSearchRunOptions,
} from "./book-location-search";
