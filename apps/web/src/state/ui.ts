import { atom } from "jotai";
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
  getReadingStatsStore,
  saveReadingStatsStore,
  type ReadingStatsStore,
} from "../features/reader/lib/reading-stats";
import {
  readNavigatorBehaviorPrefs,
  writeNavigatorBehaviorPrefs,
  type NavigatorBehaviorPrefs,
} from "../features/reader/lib/navigator-prefs";
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

/** The settings dialog's sections, for deep-links from elsewhere in the app. */
export type SettingsSectionId =
  | "general"
  | "appearance"
  | "reading"
  | "ai"
  | "plugins"
  | "shortcuts"
  | "dataSync"
  | "about";

/**
 * One-shot deep-link request: the section the settings dialog should land on
 * when it next opens (set alongside `settingsOpenAtom`, e.g. by an error's
 * "open settings" action). The dialog consumes and clears it.
 */
export const settingsSectionRequestAtom = atom<SettingsSectionId | null>(null);

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

/** Render-ready reader settings — the `auto` page color resolved against the app theme. */
export const effectiveReaderSettingsAtom = atom<ReaderSettings>((get) =>
  toEffectiveReaderSettings(get(readerPreferencesBaseAtom), get(resolvedAppThemeAtom)),
);

const navigatorPrefsBaseAtom = atom<NavigatorBehaviorPrefs>(readNavigatorBehaviorPrefs());

/** Sentence-navigator behavior: step granularity and tap-to-advance. */
export const navigatorPrefsAtom = atom(
  (get) => get(navigatorPrefsBaseAtom),
  (_get, set, next: NavigatorBehaviorPrefs) => {
    set(navigatorPrefsBaseAtom, next);
    writeNavigatorBehaviorPrefs(next);
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

/**
 * Per-book reading-time stats (interim localStorage seam). Accepts a value or an
 * updater so the tracker can increment without subscribing (write-only via
 * `useSetAtom`); the stats popover reads the value for live figures.
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
    saveReadingStatsStore(next);
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
