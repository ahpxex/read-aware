import { localKV } from "../../../platform/local-store";

const STORAGE_KEY = "read-aware-reader-settings";

/** Concrete, render-ready page color. */
export type ReaderTheme = "light" | "warm" | "dark";
/** Stored page-color preference — `auto` follows the resolved app theme. */
export type ReaderThemePreference = ReaderTheme | "auto";
/**
 * The reader's body font. Two sources:
 * - `curated:<id>` — one of our curated reading fonts, fetched and cached on
 *   demand the first time it's used (see `curated-font-loader`).
 * - `system:<family>` — a specific family installed on the user's device.
 */
export type ReaderFontFamily = `curated:${string}` | `system:${string}`;

export const CURATED_FONT_PREFIX = "curated:";
export const SYSTEM_FONT_PREFIX = "system:";

/** True when `font` is one of the curated reading fonts. */
export function isCuratedFont(font: ReaderFontFamily): font is `curated:${string}` {
  return font.startsWith(CURATED_FONT_PREFIX);
}

/** True when `font` names a user-picked installed family. */
export function isSystemFont(font: ReaderFontFamily): font is `system:${string}` {
  return font.startsWith(SYSTEM_FONT_PREFIX);
}

/** The curated font id behind a `curated:` selection, or `null` otherwise. */
export function curatedFontId(font: ReaderFontFamily): string | null {
  return isCuratedFont(font) ? font.slice(CURATED_FONT_PREFIX.length) : null;
}

/** The bare family name behind a `system:` font, or `null` otherwise. */
export function systemFontFamily(font: ReaderFontFamily): string | null {
  return isSystemFont(font) ? font.slice(SYSTEM_FONT_PREFIX.length) : null;
}

/** Tag a curated font id as a reader font selection. */
export function toCuratedFont(id: string): `curated:${string}` {
  return `${CURATED_FONT_PREFIX}${id}`;
}

/** Tag an installed family name as a reader font selection. */
export function toSystemFont(family: string): `system:${string}` {
  return `${SYSTEM_FONT_PREFIX}${family}`;
}
export type ReaderFontSize =
  | "xx-small"
  | "x-small"
  | "small"
  | "medium"
  | "large"
  | "x-large"
  | "xx-large"
  | "xxx-large";
export type ReaderLineSpacing = "compact" | "comfortable" | "relaxed";
export type ReaderParagraphSpacing = "tight" | "normal" | "loose";
/**
 * How the book is laid out and navigated:
 * - `scroll` — continuous vertical scroll, lazily loading sections as you go.
 * - `paginated-single` — page turning, one column.
 * - `paginated-double` — page turning, two columns on a wide viewport.
 */
export type ReadingMode = "scroll" | "paginated-single" | "paginated-double";

/**
 * Effective, render-ready reader settings. `theme` is always concrete here —
 * the `auto` preference has already been resolved against the app theme.
 */
export type ReaderSettings = {
  theme: ReaderTheme;
  fontFamily: ReaderFontFamily;
  fontSize: ReaderFontSize;
  lineSpacing: ReaderLineSpacing;
  paragraphSpacing: ReaderParagraphSpacing;
  readingMode: ReadingMode;
};

/** Persisted reader preferences. Differs only in that `theme` may be `auto`. */
export type ReaderSettingsPreferences = Omit<ReaderSettings, "theme"> & {
  theme: ReaderThemePreference;
};

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: "warm",
  fontFamily: "curated:inter",
  fontSize: "medium",
  lineSpacing: "comfortable",
  paragraphSpacing: "normal",
  readingMode: "scroll",
};

export const DEFAULT_READER_PREFERENCES: ReaderSettingsPreferences = {
  ...DEFAULT_READER_SETTINGS,
  theme: "warm",
};

/** Coerce a persisted font value to a valid selection, migrating legacy presets. */
export function normalizeFontFamily(value: unknown): ReaderFontFamily {
  if (typeof value === "string") {
    // Legacy presets predate the curated/system split.
    if (value === "sans") return "curated:inter";
    if (value === "serif") return "curated:literata";
    if (value.startsWith(CURATED_FONT_PREFIX) && value.length > CURATED_FONT_PREFIX.length) {
      return value as `curated:${string}`;
    }
    if (value.startsWith(SYSTEM_FONT_PREFIX) && value.length > SYSTEM_FONT_PREFIX.length) {
      return value as `system:${string}`;
    }
  }
  return DEFAULT_READER_SETTINGS.fontFamily;
}

const FONT_SIZES: ReaderFontSize[] = [
  "xx-small",
  "x-small",
  "small",
  "medium",
  "large",
  "x-large",
  "xx-large",
  "xxx-large",
];
// A brief interim build stored sizes as px strings; map them back to a tier.
const LEGACY_PX_FONT_SIZE: Record<string, ReaderFontSize> = {
  "13": "xx-small",
  "14": "x-small",
  "15": "small",
  "16": "small",
  "17": "medium",
  "18": "medium",
  "19": "large",
  "20": "large",
  "21": "x-large",
  "24": "xx-large",
  "28": "xxx-large",
};

/** Coerce a persisted font size to a valid tier. */
export function normalizeFontSize(value: unknown): ReaderFontSize {
  if (typeof value === "string") {
    if ((FONT_SIZES as string[]).includes(value)) return value as ReaderFontSize;
    if (value in LEGACY_PX_FONT_SIZE) return LEGACY_PX_FONT_SIZE[value];
  }
  return DEFAULT_READER_SETTINGS.fontSize;
}

export function getReaderPreferences(): ReaderSettingsPreferences {
  try {
    const raw = localKV.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_READER_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<ReaderSettingsPreferences>;
    return {
      theme: parsed.theme ?? DEFAULT_READER_PREFERENCES.theme,
      fontFamily: normalizeFontFamily(parsed.fontFamily),
      fontSize: normalizeFontSize(parsed.fontSize),
      lineSpacing: parsed.lineSpacing ?? DEFAULT_READER_PREFERENCES.lineSpacing,
      paragraphSpacing: parsed.paragraphSpacing ?? DEFAULT_READER_PREFERENCES.paragraphSpacing,
      readingMode: parsed.readingMode ?? DEFAULT_READER_PREFERENCES.readingMode,
    };
  } catch {
    return DEFAULT_READER_PREFERENCES;
  }
}

export function saveReaderPreferences(prefs: ReaderSettingsPreferences): void {
  localKV.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

/** Resolve a (possibly `auto`) page color against the resolved app theme. */
export function resolveReaderTheme(
  theme: ReaderThemePreference,
  appTheme: "light" | "dark",
): ReaderTheme {
  if (theme !== "auto") return theme;
  return appTheme === "dark" ? "dark" : "warm";
}

/** Project stored preferences into render-ready settings for the engine. */
export function toEffectiveReaderSettings(
  prefs: ReaderSettingsPreferences,
  appTheme: "light" | "dark",
): ReaderSettings {
  return { ...prefs, theme: resolveReaderTheme(prefs.theme, appTheme) };
}
