import { atom, getDefaultStore } from "jotai";
import {
  getAppSettings,
  resolveAppTheme,
  saveAppSettings,
  type AppSettings,
} from "../features/settings/lib/app-settings";
import {
  getGeneralSettings,
  saveGeneralSettings,
  type GeneralSettings,
} from "../features/settings/lib/general-settings";
import {
  getAIPreferences,
  saveAIPreferences,
  type AIPreferences,
} from "../features/settings/lib/ai-preferences";
import {
  getReaderPreferences,
  saveReaderPreferences,
  toEffectiveReaderSettings,
  type ReaderSettings,
  type ReaderSettingsPreferences,
} from "../features/settings/lib/reader-settings";
import {
  getReaderOverrides,
  saveReaderOverrides,
  type ReaderOverrides,
} from "../features/settings/lib/reader-overrides";
import {
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
import { onAppEvent } from "../platform/app-events";
import {
  getShelfView,
  saveShelfView,
  type ShelfView,
} from "../features/shelf/lib/shelf-view";
import {
  getShortcutBindings,
  saveShortcutBindings,
} from "../features/settings/lib/shortcut-bindings";
import type { ShortcutBindings } from "../features/settings/lib/shortcuts";

export const topNavs = ["shelf", "context", "stats"] as const;

/**
 * The active top-level surface. Beyond the fixed three, a plugin page occupies
 * this state as `plugin:<contributionKey>` (docs/plugin-system.md §5 — a page
 * is a pushed view with the header's back affordance, not a route).
 */
export type TopNav = (typeof topNavs)[number] | `plugin:${string}`;

export const activeTopNavAtom = atom<TopNav>("shelf");

export const settingsOpenAtom = atom(false);

/** The settings dialog's built-in sections. */
export type CoreSettingsSectionId =
  | "general"
  | "appearance"
  | "reading"
  | "ai"
  | "plugins"
  | "menus"
  | "shortcuts"
  | "dataSync"
  | "about";

/**
 * A deep-linkable settings section: a core section, or `plugin:<id>` for an
 * enabled plugin's own settings section (present only while that plugin is
 * enabled and declares settings; a request for a missing section is dropped).
 */
export type SettingsSectionId = CoreSettingsSectionId | `plugin:${string}`;

/**
 * One-shot deep-link request: the section the settings dialog should land on
 * when it next opens (set alongside `settingsOpenAtom`, e.g. by an error's
 * "open settings" action). The dialog consumes and clears it.
 */
export const settingsSectionRequestAtom = atom<SettingsSectionId | null>(null);

/**
 * One-shot: a sync sign-in token that arrived through a readaware:// deep
 * link (email magic link or the relay's OAuth finish page). Set by the
 * deep-link listener alongside opening Settings → Data & Sync; the connect
 * dialog consumes and clears it.
 */
export const syncLoginTokenAtom = atom<string | null>(null);

/** Resolved app chrome theme (`light`/`dark`), kept current by `useAppearance`. */
export const resolvedAppThemeAtom = atom<"light" | "dark">(
  resolveAppTheme(getAppSettings().theme),
);

const appSettingsBaseAtom = atom<AppSettings>(getAppSettings());

export const appSettingsAtom = atom(
  (get) => get(appSettingsBaseAtom),
  (_get, set, next: AppSettings) => {
    set(appSettingsBaseAtom, next);
    saveAppSettings(next);
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

const readerPreferencesBaseAtom = atom<ReaderSettingsPreferences>(getReaderPreferences());

export const readerPreferencesAtom = atom(
  (get) => get(readerPreferencesBaseAtom),
  (_get, set, next: ReaderSettingsPreferences) => {
    set(readerPreferencesBaseAtom, next);
    saveReaderPreferences(next);
  },
);

const contentTypographyBaseAtom = atom<ContentTypographySettings>(getContentTypography());

// Roamed preferences landing via sync pull: the overlay already rewrote the
// KV cache; re-seed the BASE atoms so mounted UI follows (useAppearance then
// re-applies the theme). Base atoms, not the public setters — the remote
// device logged the event, and saving here would echo it straight back.
// Lifetime listener for the same reason as plugin-storage-changed below.
onAppEvent("roaming-preferences-changed", () => {
  const store = getDefaultStore();
  store.set(appSettingsBaseAtom, getAppSettings());
  store.set(aiPreferencesBaseAtom, getAIPreferences());
  // ai-config has no atom: the chat transport reads it per-send, so the KV
  // overlay alone is enough there.
});

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
    if (mode) updateTextUnitModeSettings(mode.key, patch);
  },
);

const readerOverridesBaseAtom = atom<ReaderOverrides>(getReaderOverrides());

/** Per-book appearance overrides keyed by book id. See `useReaderAppearance`. */
export const readerOverridesAtom = atom(
  (get) => get(readerOverridesBaseAtom),
  (_get, set, next: ReaderOverrides) => {
    set(readerOverridesBaseAtom, next);
    saveReaderOverrides(next);
  },
);

const readingStatsBaseAtom = atom<ReadingStatsStore>(getReadingStatsStore());

// Reading time is event-sourced: a sync pull writes the reading_time
// projections straight through Rust, and the boot-time snapshot above knows
// nothing about it — without this, a fresh device shows empty stats until
// its next restart. Reload whenever merged events repaint the library.
// (Momentarily un-flushed tracker minutes re-appear on the next tick.)
onAppEvent("library-changed", () => {
  void loadReadingStatsStore().then((store) => {
    getDefaultStore().set(readingStatsBaseAtom, store);
  });
});

/**
 * Per-book reading-time stats, seeded from the SQLite projection at boot.
 * Memory-only here: persistence is explicit at the intent sites — the
 * tracker write-throughs each tick's delta (`recordReadingTime`), the stats
 * demo seed bulk-replaces (`replaceReadingStatsStore`). Accepts a value or
 * an updater so the tracker can increment without subscribing.
 */
export const readingStatsAtom = atom(
  (get) => get(readingStatsBaseAtom),
  (
    get,
    set,
    update: ReadingStatsStore | ((prev: ReadingStatsStore) => ReadingStatsStore),
  ) => {
    const next =
      typeof update === "function" ? update(get(readingStatsBaseAtom)) : update;
    set(readingStatsBaseAtom, next);
  },
);

const shelfViewBaseAtom = atom<ShelfView>(getShelfView());

export const shelfViewAtom = atom(
  (get) => get(shelfViewBaseAtom),
  (_get, set, next: ShelfView) => {
    set(shelfViewBaseAtom, next);
    saveShelfView(next);
  },
);

/** Multi-select state for shelf batch management. Ephemeral — never persisted. */
export type ShelfSelection = { active: boolean; ids: string[] };

export const shelfSelectionAtom = atom<ShelfSelection>({ active: false, ids: [] });

/** The collection currently being viewed on the shelf, or null at the top level. */
export const activeCollectionAtom = atom<string | null>(null);

const shortcutBindingsBaseAtom = atom<ShortcutBindings>(getShortcutBindings());

/** User overrides for rebindable keyboard shortcuts. See `lib/shortcuts`. */
export const shortcutBindingsAtom = atom(
  (get) => get(shortcutBindingsBaseAtom),
  (_get, set, next: ShortcutBindings) => {
    set(shortcutBindingsBaseAtom, next);
    saveShortcutBindings(next);
  },
);
