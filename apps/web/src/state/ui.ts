import { atom, getDefaultStore } from "jotai";
import { READER_LANGUAGES_KEY, getReaderBookLanguages } from "../features/settings/lib/reader-languages";
import { causalActor, stampEventCause, type DomainActor } from "../platform/domain-actor";
import {
  APP_SETTINGS_KEY,
  getAppSettings,
  resolveAppTheme,
  saveAppSettings,
  type AppSettings,
} from "../features/settings/lib/app-settings";
import {
  GENERAL_SETTINGS_KEY,
  getGeneralSettings,
  saveGeneralSettings,
  type GeneralSettings,
} from "../features/settings/lib/general-settings";
import {
  AI_PREFERENCES_KEY,
  getAIPreferences,
  saveAIPreferences,
  type AIPreferences,
} from "../features/settings/lib/ai-preferences";
import {
  READER_PREFERENCES_KEY,
  getReaderPreferences,
  saveReaderPreferences,
  toEffectiveReaderSettings,
  type ReaderSettings,
  type ReaderSettingsPreferences,
} from "../features/settings/lib/reader-settings";
import {
  READER_OVERRIDES_KEY,
  getReaderOverrides,
  saveReaderOverrides,
  type ReaderOverrides,
} from "../features/settings/lib/reader-overrides";
import {
  CONTENT_TYPOGRAPHY_KEY,
  getContentTypography,
  saveContentTypography,
  type ContentTypographySettings,
} from "../features/settings/lib/content-typography";
import {
  getReadingStatsStore,
  loadReadingStatsStore,
  type ReadingStatsStore,
} from "../features/reader/lib/reading-stats";
import {
  readTextUnitModeSettings,
  updateTextUnitModeSettings,
  type TextUnitModeSettings,
} from "../features/reader/lib/text-unit-mode-state";
import { textUnitReaderModeAtom } from "../features/plugins/state/plugin-store";
import { FIXED_LAYOUT_ZOOM_KEY, getFixedLayoutViews } from "../domain/reading-zoom";
import { onAppEvent } from "../platform/app-events";
import { createLogger } from "../platform/logger";
import { SHELF_VIEW_KEY, getShelfView, saveShelfView, type ShelfView } from "../features/shelf/lib/shelf-view";
import {
  PAGE_TURN_SETTINGS_KEY,
  getPageTurnSettings,
  savePageTurnSettings,
  type PageTurnSettings,
} from "../domain/settings/page-turn-settings";
import {
  HEADER_FOOTER_SETTINGS_KEY,
  getHeaderFooterSettings,
  saveHeaderFooterSettings,
  type HeaderFooterSettings,
} from "../domain/settings/header-footer-settings";
import { getShortcutBindings, SHORTCUT_BINDINGS_KEY } from "../features/settings/lib/shortcut-bindings";
import type { ShortcutBindings } from "../features/settings/lib/shortcuts";
import { onLocalKVChange } from "../platform/local-store";
import { i18n, setLocale } from "../i18n";
import { detectInitialLocale } from "../i18n/detect";

export const topNavs = ["shelf", "agent", "stats"] as const;

/**
 * The active top-level surface. Beyond the fixed three, a plugin page occupies
 * this state as `plugin:<contributionKey>` (docs/plugins/plugin-system.md §5 — a page
 * is a pushed view with the header's back affordance, not a route).
 */
export type TopNav = (typeof topNavs)[number] | `plugin:${string}`;

/** Keep provenance beside ephemeral values; it never enters persistence or plugin data. */
function workspaceValue<T>(initial: T) {
  const source = atom(stampEventCause({ value: initial }, "system"));
  const value = atom(
    (get) => get(source).value,
    (get, set, update: T | ((previous: T) => T), origin: DomainActor = "user") => {
      const previous = get(source).value;
      const next = typeof update === "function" ? (update as (previous: T) => T)(previous) : update;
      if (!Object.is(previous, next)) set(source, stampEventCause({ value: next }, causalActor(origin)));
    },
  );
  return { value, source: atom((get) => get(source)) };
}
const topNavState = workspaceValue<TopNav>("shelf");
export const activeTopNavAtom = topNavState.value;
const settingsOpenState = workspaceValue(false);
export const settingsOpenAtom = settingsOpenState.value;
const activeSectionState = workspaceValue<SettingsSectionId | null>(null);
export const activeSettingsSectionAtom = activeSectionState.value;
const commandQueryState = workspaceValue("");
export const commandQueryAtom = commandQueryState.value;
const commandSearchState = workspaceValue(false);
export const commandSearchOpenAtom = atom(
  (get) => get(commandSearchState.value),
  (get, set, open: boolean, origin: DomainActor = "user") => {
    const source = causalActor(origin);
    if (open && !get(commandSearchState.value)) set(commandQueryAtom, "", source);
    set(commandSearchState.value, open, source);
  },
);

/** The settings dialog's built-in sections. */
export type CoreSettingsSectionId = typeof import("@read-aware/core").WORKSPACE_SETTINGS_SECTIONS[number];

/**
 * A deep-linkable settings section: a core section, or `plugin:<id>` for an
 * enabled plugin's own settings section (present only while that plugin is
 * enabled and declares settings; a request for a missing section is dropped).
 */
export type SettingsSectionId = import("@read-aware/core").WorkspaceSettingsSection;

/**
 * One-shot deep-link request: the section the settings dialog should land on
 * when it next opens (set alongside `settingsOpenAtom`, e.g. by an error's
 * "open settings" action). The dialog consumes and clears it.
 */
const sectionRequestState = workspaceValue<SettingsSectionId | null>(null);
export const settingsSectionRequestAtom = sectionRequestState.value;

/**
 * One-shot: a sync sign-in token that arrived through a readaware:// deep
 * link (email magic link or the relay's OAuth finish page). Set by the
 * deep-link listener alongside opening Settings → Data & Sync; the connect
 * dialog consumes and clears it.
 */
export const syncLoginTokenAtom = atom<string | null>(null);

/** Resolved app chrome theme (`light`/`dark`), kept current by `useAppearance`. */
export const resolvedAppThemeStateAtom = atom(stampEventCause({ value: resolveAppTheme(getAppSettings().theme) }));
export const resolvedAppThemeAtom = atom(
  (get) => get(resolvedAppThemeStateAtom).value,
  (get, set, value: "light" | "dark", origin: DomainActor = "system") => {
    if (get(resolvedAppThemeStateAtom).value !== value)
      set(resolvedAppThemeStateAtom, stampEventCause({ value }, origin));
  },
);

const appSettingsBaseAtom = atom<AppSettings>(stampEventCause({ ...getAppSettings() }));

export const appSettingsAtom = atom(
  (get) => get(appSettingsBaseAtom),
  (_get, set, next: AppSettings) => {
    const origin = causalActor("user");
    set(appSettingsBaseAtom, stampEventCause({ ...next }, origin));
    saveAppSettings(next, origin);
  },
);

const generalSettingsBaseAtom = atom<GeneralSettings>(getGeneralSettings());

export const generalSettingsAtom = atom(
  (get) => get(generalSettingsBaseAtom),
  (_get, set, next: GeneralSettings) => {
    set(generalSettingsBaseAtom, next);
    saveGeneralSettings(next);
  },
);

const aiPreferencesBaseAtom = atom<AIPreferences>(getAIPreferences());

export const aiPreferencesAtom = atom(
  (get) => get(aiPreferencesBaseAtom),
  (_get, set, next: AIPreferences) => {
    set(aiPreferencesBaseAtom, next);
    saveAIPreferences(next);
  },
);

const readerPreferencesBaseAtom = atom<ReaderSettingsPreferences>(stampEventCause({ ...getReaderPreferences() }));
const readerBookLanguagesBaseAtom = atom(stampEventCause(getReaderBookLanguages()));
export const readerBookLanguagesAtom = atom((get) => get(readerBookLanguagesBaseAtom));

/** How each fixed-layout book was last viewed here — zoom and place on the page (see `domain/reading-zoom.ts`). */
const fixedLayoutViewsBaseAtom = atom(stampEventCause(getFixedLayoutViews()));
export const fixedLayoutViewsAtom = atom((get) => get(fixedLayoutViewsBaseAtom));

export const readerPreferencesAtom = atom(
  (get) => get(readerPreferencesBaseAtom),
  (_get, set, next: ReaderSettingsPreferences) => {
    const origin = causalActor("user");
    set(readerPreferencesBaseAtom, stampEventCause({ ...next }, origin));
    saveReaderPreferences(next, origin);
  },
);

const contentTypographyBaseAtom = atom<ContentTypographySettings>(getContentTypography());

/** Typography for the app's content surfaces (chat, notes, plugin markdown). */
export const contentTypographyAtom = atom(
  (get) => get(contentTypographyBaseAtom),
  (_get, set, next: ContentTypographySettings) => {
    set(contentTypographyBaseAtom, next);
    saveContentTypography(next);
  },
);

/** Render-ready reader settings — the `auto` page color resolved against the app theme. */
export const effectiveReaderSettingsAtom = atom<ReaderSettings>((get) =>
  toEffectiveReaderSettings(get(readerPreferencesBaseAtom), get(resolvedAppThemeAtom)),
);

// The mode's behavior settings live in its plugin's declared-settings object;
// this revision atom re-derives the view of them whenever any plugin storage
// changes (its own settings page, the agent, or a host write below).
//
// The listener is registered for the app's lifetime, NOT onMount: the plugin
// settings page is reachable only while no reader is mounted, so a
// mounted-only listener would miss exactly the writes it exists for and the
// derived atom would serve its cached pre-edit value on the next mount.
const textUnitModeSettingsRevisionAtom = atom(0);
onAppEvent("plugin-storage-changed", () => {
  getDefaultStore().set(textUnitModeSettingsRevisionAtom, (current) => current + 1);
});

/**
 * Host behavior for the plugin-defined text-unit reader mode, read from the
 * owning plugin's settings. Writes accept a partial patch and merge it into
 * that same settings object, so the plugin's settings page stays in sync.
 */
export const textUnitModeSettingsAtom = atom(
  (get) => {
    get(textUnitModeSettingsRevisionAtom);
    return readTextUnitModeSettings(get(textUnitReaderModeAtom)?.key ?? null);
  },
  (get, _set, patch: Partial<TextUnitModeSettings>) => {
    const mode = get(textUnitReaderModeAtom);
    // observedWrite logs a failed save; the atom setter has no caller to report to.
    if (mode) void updateTextUnitModeSettings(mode.key, patch);
  },
);

const readerOverridesBaseAtom = atom<ReaderOverrides>(stampEventCause(getReaderOverrides()));

/** Per-book appearance overrides keyed by book id. See `useReaderAppearance`. */
export const readerOverridesAtom = atom(
  (get) => get(readerOverridesBaseAtom),
  (_get, set, next: ReaderOverrides) => {
    const origin = causalActor("user");
    set(readerOverridesBaseAtom, stampEventCause({ ...next }, origin));
    saveReaderOverrides(next, origin);
  },
);

// KV is the shared optimistic/durable overlay. Re-seed base atoms on writes,
// remote edits and rollback without sending a second persistence command.
// Roaming overlays also use localKV; their later broad invalidation must not
// re-label a value that has already been superseded by a local write.
onLocalKVChange((key, _value, origin) => {
  const store = getDefaultStore();
  switch (key) {
    case APP_SETTINGS_KEY:
      store.set(appSettingsBaseAtom, stampEventCause({ ...getAppSettings() }, origin));
      break;
    case CONTENT_TYPOGRAPHY_KEY:
      store.set(contentTypographyBaseAtom, getContentTypography());
      break;
    case AI_PREFERENCES_KEY:
      store.set(aiPreferencesBaseAtom, getAIPreferences());
      break;
    case SHELF_VIEW_KEY:
      store.set(shelfViewBaseAtom, getShelfView());
      break;
    case PAGE_TURN_SETTINGS_KEY:
      store.set(pageTurnSettingsBaseAtom, getPageTurnSettings());
      break;
    case HEADER_FOOTER_SETTINGS_KEY:
      store.set(headerFooterSettingsBaseAtom, getHeaderFooterSettings());
      break;
    case SHORTCUT_BINDINGS_KEY:
      store.set(shortcutBindingsBaseAtom, getShortcutBindings());
      break;
    case READER_PREFERENCES_KEY:
      store.set(readerPreferencesBaseAtom, stampEventCause({ ...getReaderPreferences() }, origin));
      break;
    case READER_LANGUAGES_KEY:
      store.set(readerBookLanguagesBaseAtom, stampEventCause(getReaderBookLanguages(), origin));
      break;
    case FIXED_LAYOUT_ZOOM_KEY:
      store.set(fixedLayoutViewsBaseAtom, stampEventCause(getFixedLayoutViews(), origin));
      break;
    case READER_OVERRIDES_KEY:
      store.set(readerOverridesBaseAtom, stampEventCause(getReaderOverrides(), origin));
      break;
    case GENERAL_SETTINGS_KEY: {
      const settings = getGeneralSettings();
      store.set(generalSettingsBaseAtom, settings);
      const locale = detectInitialLocale(settings.language);
      if (i18n.isInitialized) void setLocale(locale, origin);
      break;
    }
  }
});

const readingStatsBaseAtom = atom<ReadingStatsStore>(getReadingStatsStore());

// Reading time is event-sourced: a sync pull writes the reading_time
// projections straight through Rust, and the boot-time snapshot above knows
// nothing about it — without this, a fresh device shows empty stats until
// its next restart. Reload whenever merged events repaint the library.
// (Momentarily un-flushed tracker minutes re-appear on the next tick.)
// A failed reload keeps the last good snapshot; the next library change retries.
const log = createLogger("reading-stats");
onAppEvent("library-changed", () => {
  void loadReadingStatsStore().then(
    (store) => {
      getDefaultStore().set(readingStatsBaseAtom, store);
    },
    (error: unknown) => {
      log.warn("Reading stats reload failed; keeping the previous snapshot", error);
    },
  );
});

/**
 * Per-book reading-time stats, seeded from the SQLite projection at boot.
 * Memory-only here: persistence is explicit at the intent sites — the
 * tracker accrues each tick into the reading-session scratch pad and closes
 * sessions into `book.sessionRecorded` events (`platform/reading-session.ts`).
 * The atom accepts a value or an updater for local mirror changes.
 */
export const readingStatsAtom = atom(
  (get) => get(readingStatsBaseAtom),
  (get, set, update: ReadingStatsStore | ((prev: ReadingStatsStore) => ReadingStatsStore)) => {
    const next = typeof update === "function" ? update(get(readingStatsBaseAtom)) : update;
    set(readingStatsBaseAtom, next);
  },
);

const shelfViewBaseAtom = atom<ShelfView>(getShelfView());
const pageTurnSettingsBaseAtom = atom<PageTurnSettings>(getPageTurnSettings());

/** Tap-zone and volume-key page turning. Device-local, never per book. */
export const pageTurnSettingsAtom = atom(
  (get) => get(pageTurnSettingsBaseAtom),
  (_get, set, next: PageTurnSettings) => {
    set(pageTurnSettingsBaseAtom, next);
    savePageTurnSettings(next);
  },
);

const headerFooterSettingsBaseAtom = atom<HeaderFooterSettings>(getHeaderFooterSettings());

/** Reader header/footer info strips. Device-local, never per book. */
export const headerFooterSettingsAtom = atom(
  (get) => get(headerFooterSettingsBaseAtom),
  (_get, set, next: HeaderFooterSettings) => {
    set(headerFooterSettingsBaseAtom, next);
    saveHeaderFooterSettings(next);
  },
);

export const shelfViewAtom = atom(
  (get) => get(shelfViewBaseAtom),
  (_get, set, next: ShelfView) => {
    set(shelfViewBaseAtom, next);
    saveShelfView(next);
  },
);

/** Multi-select state for shelf batch management. Ephemeral — never persisted. */
export type ShelfSelection = { active: boolean; ids: string[] };

const shelfSelectionState = workspaceValue<ShelfSelection>({ active: false, ids: [] });
export const shelfSelectionAtom = shelfSelectionState.value;

/** The collection currently being viewed on the shelf, or null at the top level. */
const activeCollectionState = workspaceValue<string | null>(null);
export const activeCollectionAtom = activeCollectionState.value;
/** Host-only per-field sources for the workspace commit adapter. */
export const workspaceSourcesAtom = atom((get) => ({
  surface: get(topNavState.source),
  collection: get(activeCollectionState.source),
  selection: get(shelfSelectionState.source),
  settingsOpen: get(settingsOpenState.source),
  section: get(activeSectionState.source),
  sectionRequest: get(sectionRequestState.source),
  searchOpen: get(commandSearchState.source),
  query: get(commandQueryState.source),
}));

const shortcutBindingsBaseAtom = atom<ShortcutBindings>(getShortcutBindings());

/** User overrides for rebindable keyboard shortcuts. See `lib/shortcuts`. */
export const shortcutBindingsAtom = atom((get) => get(shortcutBindingsBaseAtom));
