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
  getShelfView,
  saveShelfView,
  type ShelfView,
} from "../features/shelf/lib/shelf-view";

export const topNavs = ["shelf", "context"] as const;

export type TopNav = (typeof topNavs)[number];

export const activeTopNavAtom = atom<TopNav>("shelf");

export const settingsOpenAtom = atom(false);

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

const shelfViewBaseAtom = atom<ShelfView>(getShelfView());

export const shelfViewAtom = atom(
  (get) => get(shelfViewBaseAtom),
  (_get, set, next: ShelfView) => {
    set(shelfViewBaseAtom, next);
    saveShelfView(next);
  },
);
