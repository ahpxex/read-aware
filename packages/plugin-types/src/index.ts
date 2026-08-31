/**
 * @read-aware/plugin-types — the public plugin API contract.
 *
 * This package is the single source of truth for every type a plugin author
 * touches (docs/plugin-system.md). The app re-exports it (its surfaces build
 * on these shapes), and the marketplace repo's TypeScript template ships a
 * declaration copy of it so plugins get full typing with zero dependencies.
 *
 * ## Construction rules (docs/plugin-system.md §4–§6)
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
 * Permission domains a manifest may declare (docs/plugin-system.md §4).
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

// ─── Manifest ────────────────────────────────────────────────────────────────

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
  /** Entry module relative to the plugin folder. Defaults to "main.js". */
  main?: string;
  /**
   * Declarative settings: rendered by the app from the Plugins panel; edits
   * write through as one object under the plugin's storage key `settings`
   * (read with `ctx.services.storage.get("settings")`).
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
  synthesize(input: {
    text: string;
    voiceId: string;
  }): Promise<ArrayBuffer | Uint8Array>;
};

// ─── Schedule declarations ───────────────────────────────────────────────────

/** The floor the host clamps `everyMinutes` to. */
export const MIN_SCHEDULE_MINUTES = 15;

export type PluginScheduleDeclaration = {
  /** Unique within the plugin: lowercase letters, digits, hyphens. */
  id: string;
  /** Shown at install time and in the Plugins panel. */
  label: string;
  /** Cadence in minutes, floored at MIN_SCHEDULE_MINUTES. */
  everyMinutes: number;
};

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
export type PluginReaderFontWeight = "light" | "regular" | "medium" | "bold";
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
  /**
   * Sort and group items by `timestamp`, with host-owned Today / This week /
   * This month / All tabs. Search is debounced by the host.
   */
  timeline?: boolean;
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
      min?: number;
      max?: number;
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
  resolveOptions?: (
    fieldId: string,
    values: PluginFormValues,
  ) => PluginSelectOption[] | Promise<PluginSelectOption[]>;
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
  | { kind: "progress"; value: number; max?: number; label?: string; showValue?: boolean }
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

export type PluginView =
  | PluginMarkdownView
  | PluginListView
  | PluginFormView
  | PluginBlocksView
  | PluginDetailView;

/**
 * What an action / list-select / form-submit may produce:
 * - `undefined` / `null` — nothing happens (surface stays as is);
 * - `{ toast }` — a transient notice;
 * - `{ view }` — open (or push onto) the surface with this view;
 * - `{ view, navigation: "replace" | "reset" }` — replace the current view
 *   or return the surface to a new root view;
 * - `{ close: true }` — dismiss the surface (composable with `toast`);
 * - `{ fieldErrors }` (from a form submit) — stay on the form and show the
 *   errors under their fields.
 */
export type PluginViewResult =
  | void
  | undefined
  | null
  | {
      toast?: string;
      view?: PluginView;
      navigation?: "push" | "replace" | "reset";
      close?: boolean;
      fieldErrors?: Record<string, string>;
    };

// ─── UI contributions ────────────────────────────────────────────────────────

/** Where a selection action was triggered from. */
export type SelectionActionSource = "selection" | "annotation" | "navigator";

export type SelectionActionInput = {
  text: string;
  /** Surrounding passage when the reader can recover it. */
  context?: string;
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
  title: PluginText;
  icon?: string;
  /** Optional host semantic used by the matching keyboard command. */
  role?: "lookup";
  /** Opens the host Dialog immediately in a loading state before `run` resolves. */
  presentation?: "dialog";
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
  title: PluginText;
  icon?: string;
  surface: PluginHeaderSurface;
  /** Shelf only — the reader never allows full-page interruptions. */
  presentation?: "popup" | "page";
  view: (input: HeaderActionInput) => PluginView | Promise<PluginView>;
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
  /** Segment one block. Results must be ordered, non-overlapping spans. */
  segmentText(
    input: PluginReaderTextSegmentInput,
  ): PluginReaderTextSegment[];
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

// ─── Events ──────────────────────────────────────────────────────────────────

/**
 * A domain event as delivered to a plugin subscription: the canonical type +
 * payload from the app's event catalog (@read-aware/core events.ts), with the
 * software-actor origin and display timestamp. Persistence internals (HLC,
 * event ids) are not part of the plugin surface.
 */
export type PluginDomainEvent<K extends DomainEventType = DomainEventType> = {
  [T in DomainEventType]: {
    type: T;
    payload: Extract<DomainEvent, { type: T }>["payload"];
    createdAt: string;
    origin: EventOrigin;
  };
}[K];

/** Subscribe helper: one domain's event names, canonical, fully typed. */
export type DomainSubscribe<E extends DomainEventType> = <K extends E>(
  event: K,
  handler: (event: PluginDomainEvent<K>) => void,
  options?: {
    /**
     * Skip events produced by this plugin's own writes (origin
     * `plugin:<id>`). Default false — by default you hear your own echoes.
     */
    ignoreSelf?: boolean;
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
export type ReadingDomainEventType =
  | "book.opened"
  | "book.finished"
  | "book.progressed"
  | "book.timeRecorded";

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

/**
 * Session facts — runtime state of the open reader, NOT domain events (they
 * describe what is on screen, never enter the event log, and need no
 * permission). `book.opened` the domain event exists separately under
 * `books.on` because opening also mutates domain state (last-opened recency).
 */
export type PluginSessionEventMap = {
  "book-opened": { book: { id: string; title: string; author?: string } };
  "book-closed": { bookId: string };
  "chapter-changed": { bookId: string; chapterHref: string | null };
  /** Fires on page turns; fraction is 0..1. */
  "reading-progress": { bookId: string; fraction: number };
};

export type PluginSessionEventName = keyof PluginSessionEventMap;

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
      get(bookId: string): Promise<PluginBook | null>;
      getToc(bookId: string): Promise<PluginChapterRef[]>;
      getChapterText(bookId: string, chapterIndex: number): Promise<string | null>;
    };
    collections: {
      list(): Promise<PluginCollection[]>;
      booksIn(collectionId: string): Promise<string[]>;
    };
  };
  commands?: {
    books: {
      importBook(input: {
        fileName: string;
        data: ArrayBuffer | Uint8Array;
      }): Promise<PluginBook>;
      editMetadata(bookId: string, patch: { title?: string; author?: string }): Promise<void>;
      setStarred(bookId: string, starred: boolean): Promise<void>;
      remove(bookId: string): Promise<void>;
      addVirtualBook(input: {
        providerId: string;
        key: string;
        title: string;
        author?: string;
      }): Promise<PluginBook>;
      removeVirtualBook(input: { providerId: string; key: string }): Promise<void>;
    };
    collections: {
      create(name: string): Promise<PluginCollection>;
      rename(collectionId: string, name: string): Promise<void>;
      remove(collectionId: string): Promise<void>;
      assignBooks(bookIds: string[], collectionId: string | null): Promise<void>;
    };
  };
  events: { subscribe: DomainSubscribe<LibraryDomainEventType> };
};

export type PluginReadingDomain = {
  queries: {
    stats: {
      forBook(bookId: string): Promise<PluginBookStats | null>;
      list(): Promise<PluginBookStats[]>;
      overview(): Promise<PluginStatsOverview>;
    };
  };
  commands?: {
    setFinished(bookId: string, finished: boolean): Promise<void>;
    openBook(bookId: string): void;
    goTo(target: { bookId?: string; cfi?: string; href?: string }): void;
  };
  events: { subscribe: DomainSubscribe<ReadingDomainEventType> };
};

/**
 * Annotations — highlights, notes, and asks. Asks are read-only: they are the
 * agent runtime's passive traces, not a plugin-writable kind.
 */
export type PluginAnnotationsDomain = {
  queries: {
    list(filter?: {
      bookId?: string;
      kind?: "highlight" | "note" | "ask";
      query?: string;
    }): Promise<PluginAnnotation[]>;
  };
  commands?: {
    createHighlight(input: {
      bookId: string;
      text: string;
      anchor?: string | null;
      chapterHref?: string | null;
      color?: HighlightColor;
      style?: HighlightStyle;
    }): Promise<PluginHighlight>;
    recolorHighlight(highlightId: string, color: HighlightColor): Promise<void>;
    removeHighlight(highlightId: string): Promise<void>;
    createNote(input: {
      bookId: string;
      body: string;
      quotedText?: string;
      anchor?: string | null;
      chapterHref?: string | null;
    }): Promise<PluginNote>;
    updateNote(noteId: string, body: string): Promise<void>;
    removeNote(noteId: string): Promise<void>;
  };
  events: { subscribe: DomainSubscribe<AnnotationDomainEventType> };
};

/**
 * Conversations — read-only view over the user's AI threads (one persistent
 * thread per book, plus user-created global threads). Writes stay with the
 * chat runtime; its dual-write is what feeds `on`.
 */
export type PluginConversationsDomain = {
  queries: {
    getBookThread(bookId: string): Promise<PluginChatMessage[]>;
    listThreads(): Promise<PluginThreadSummary[]>;
    getThread(threadId: string): Promise<PluginChatMessage[]>;
  };
  events: { subscribe: DomainSubscribe<ConversationDomainEventType> };
};

export type PluginSettingsDomain = {
  queries: {
    discover(query?: SettingsQuery): Promise<SettingCatalogEntry[]>;
    read(path: string, target?: SettingsQueryTarget): Promise<SettingReadResult>;
  };
  commands: {
    update(changes: SettingChange[]): Promise<SettingsUpdateResult>;
  };
  events: {
    subscribe(
      handler: (event: SettingsChangedEvent) => void,
      options?: { ignoreSelf?: boolean },
    ): PluginDisposable;
  };
};

export type PluginDomains = {
  library?: PluginLibraryDomain;
  reading?: PluginReadingDomain;
  annotations?: PluginAnnotationsDomain;
  conversations?: PluginConversationsDomain;
  settings: PluginSettingsDomain;
};

// ─── Context handed to activate() ────────────────────────────────────────────

export type PluginStorage = {
  get<T = unknown>(key: string): T | null;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  /**
   * A named document collection — structured plugin-private data one tier
   * above the KV (queryable, per-document, optionally book-anchored). Backed
   * by the app's local store; lifecycle belongs to the plugin (uninstall
   * clears it). `bookId`/`anchor` are provenance INDEXES, not ownership —
   * documents survive the referenced book's deletion.
   */
  collection(name: string): PluginDocumentCollection;
  /**
   * Fires when this plugin's namespace is written from OUTSIDE the plugin —
   * its settings page, the reading agent, another surface editing the same
   * object. The plugin's own `set`/`remove` calls do not echo back. Use it
   * to re-read (or re-derive from) settings you would otherwise have cached
   * at activate().
   */
  onChange(handler: () => void): PluginDisposable;
};

export type PluginMigrationStorage = Omit<PluginStorage, "onChange">;

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
};

export type PluginDocumentCollection = {
  put(id: string, data: unknown, options?: { bookId?: string; anchor?: string }): Promise<void>;
  get<T = unknown>(id: string): Promise<PluginDocument<T> | null>;
  delete(id: string): Promise<void>;
  /** Newest-first by default. */
  list<T = unknown>(filter?: {
    bookId?: string;
    limit?: number;
    oldestFirst?: boolean;
  }): Promise<PluginDocument<T>[]>;
};

export type PluginAgentScope =
  | { kind: "global"; threadId: string }
  | { kind: "book"; bookId: string };

export type PluginAgentContextBlock = {
  title?: string;
  content: string;
};

export type PluginAgentContextProvider = {
  id: string;
  contexts?: Array<PluginAgentScope["kind"]>;
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

export type PluginMemoryCandidateProvider = {
  id: string;
  contexts?: Array<PluginAgentScope["kind"]>;
  propose(input: {
    scope: PluginAgentScope;
    userText: string;
    assistantText: string;
  }): PluginMemoryCandidate[] | Promise<PluginMemoryCandidate[]>;
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
  putEventBatch(
    deviceId: string,
    index: number,
    events: SealedEventWire[],
  ): Promise<void>;
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

export type PluginContributions = {
  selectionActions: {
    register(action: PluginSelectionAction): PluginDisposable;
  };
  headerActions: {
    register(action: PluginHeaderAction): PluginDisposable;
  };
  commands: {
    register(command: PluginCommand): PluginDisposable;
  };
  settingsOptions: {
    register(
      fieldId: string,
      provider: (
        values: PluginFormValues,
      ) => PluginSelectOption[] | Promise<PluginSelectOption[]>,
    ): PluginDisposable;
  };
  voiceProviders: {
    register(provider: PluginVoiceProvider): PluginDisposable;
  };
  contentProviders: {
    register(provider: {
      id: string;
      load(key: string): Promise<PluginBookContent>;
    }): PluginDisposable;
  };
  readerModes?: {
    register(mode: PluginReaderMode): PluginDisposable;
  };
  agentTools?: {
    register(tool: PluginToolDefinition): PluginDisposable;
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

export type PluginHostServices = {
  storage: PluginStorage;
  secrets: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  ui: {
    showToast(message: string): void;
    exportFile(file: PluginExportFile): Promise<boolean>;
  };
  schedules: {
    bind(scheduleId: string, run: () => void | Promise<void>): PluginDisposable;
  };
  session: {
    subscribe<K extends PluginSessionEventName>(
      event: K,
      handler: (payload: PluginSessionEventMap[K]) => void,
    ): PluginDisposable;
  };
  network?: {
    fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  };
  llm?: {
    ask(input: {
      prompt: string;
      system?: string;
      model?: "fast" | "smart";
      onText?: (delta: string) => void;
    }): Promise<string>;
    ask(input: {
      prompt: string;
      system?: string;
      model?: "fast" | "smart";
      schema: Record<string, unknown>;
    }): Promise<unknown>;
  };
  clipboard?: {
    writeText(text: string): Promise<void>;
  };
};

/** The actor-scoped capability view handed to `activate()`. */
export type PluginContext = {
  readonly manifest: Readonly<PluginManifest>;
  readonly appVersion: string;
  readonly locale: string;
  readonly lifecycle: { readonly phase: PluginLifecyclePhase };
  /** Only capabilities visible to this plugin actor, with host-side versions. */
  readonly capabilities: Readonly<PluginCapabilityView>;
  domains: PluginDomains;
  contributions: PluginContributions;
  services: PluginHostServices;
};

/** The default export of a plugin's entry module. */
export type PluginModule = {
  activate(ctx: PluginContext): void | Promise<void>;
  /** Runs with storage-only authority before a changed data schema is committed. */
  migrate?(ctx: PluginMigrationContext, migration: PluginMigration): void | Promise<void>;
  deactivate?(): void | Promise<void>;
};
