import { hasCoarsePointer } from "../../../platform/environment";
import { localKV } from "../../../platform/local-store";
import { isPluginRef } from "../../plugins/lib/plugin-theme";

const STORAGE_KEY = "read-aware-reader-settings";

/** The app's own page colors, always available. */
export type BuiltinReaderTheme = "light" | "warm" | "dark";
/**
 * Concrete, render-ready page color: a built-in, or a plugin theme ref
 * (`plugin:<pluginId>:<themeId>`). A ref's palette resolves through the
 * plugin theme registry at render time (`resolveReaderPalette`), falling back
 * to `warm` while the plugin is missing — the stored value survives so
 * re-enabling the plugin restores the look.
 */
export type ReaderTheme = BuiltinReaderTheme | `plugin:${string}`;
/** Stored page-color preference — `auto` follows the resolved app theme. */
export type ReaderThemePreference = ReaderTheme | "auto";
/**
 * The reader's body font. Three sources:
 * - `curated:<id>` — one of our curated reading fonts, fetched and cached on
 *   demand the first time it's used (see `curated-font-loader`).
 * - `system:<family>` — a specific family installed on the user's device.
 * - `plugin:<pluginId>:<fontId>` — a font bundled by an enabled plugin,
 *   served straight from its folder.
 */
export type ReaderFontFamily =
  | `curated:${string}`
  | `system:${string}`
  | `plugin:${string}`;

export const CURATED_FONT_PREFIX = "curated:";
export const SYSTEM_FONT_PREFIX = "system:";
export const PLUGIN_FONT_PREFIX = "plugin:";

/** True when `font` is one of the curated reading fonts. */
export function isCuratedFont(font: ReaderFontFamily): font is `curated:${string}` {
  return font.startsWith(CURATED_FONT_PREFIX);
}

/** True when `font` names a user-picked installed family. */
export function isSystemFont(font: ReaderFontFamily): font is `system:${string}` {
  return font.startsWith(SYSTEM_FONT_PREFIX);
}

/** True when `font` names a plugin-bundled font. */
export function isPluginFont(font: ReaderFontFamily): font is `plugin:${string}` {
  return font.startsWith(PLUGIN_FONT_PREFIX);
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
/**
 * Body-text weight presets. Each maps to a numeric CSS weight in
 * `reader-css.ts`; fonts that lack a face for the exact number render the
 * nearest available weight (standard CSS font matching).
 */
export type ReaderFontWeight = "light" | "regular" | "medium" | "bold";
export type ReaderLineSpacing = "compact" | "comfortable" | "relaxed";
export type ReaderParagraphSpacing = "tight" | "normal" | "loose";
/**
 * Page margin presets — each drives the text measure, the paginator gap, and
 * the body padding together (see `reader-css.ts`). The default is
 * device-appropriate: mobile-typical tight margins on touch screens, the
 * roomier editorial measure on desktop.
 */
export type ReaderPageMargins = "narrow" | "medium" | "wide";
/**
 * How the book is laid out and navigated:
 * - `scroll` — continuous vertical scroll, lazily loading sections as you go.
 * - `paginated-single` — page turning, one column.
 * - `paginated-double` — page turning, two columns on a wide viewport.
 */
export type ReadingMode = "scroll" | "paginated-single" | "paginated-double";

/**
 * Body-text alignment.
 *
 * `book` — the default — declares nothing and lets the publisher's stylesheet
 * decide. That is deliberate: for CJK, justified text is the correct setting
 * (no inter-word spaces to stretch, so no rivers), while English justified
 * without hyphenation reads worse than ragged-right. The publisher usually
 * knows which of those their book is. The other two force the choice, for
 * readers who have a preference and want it to hold everywhere.
 */
export type ReaderTextAlign = "book" | "start" | "justify";

/**
 * Effective, render-ready reader settings. `theme` is always concrete here —
 * the `auto` preference has already been resolved against the app theme.
 */
export type ReaderSettings = {
  theme: ReaderTheme;
  fontFamily: ReaderFontFamily;
  fontSize: ReaderFontSize;
  fontWeight: ReaderFontWeight;
  lineSpacing: ReaderLineSpacing;
  paragraphSpacing: ReaderParagraphSpacing;
  pageMargins: ReaderPageMargins;
  textAlign: ReaderTextAlign;
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
  fontWeight: "regular",
  lineSpacing: "comfortable",
  paragraphSpacing: "normal",
  textAlign: "book",
  // Touch screens read with mobile-typical tight margins by default; desktop
  // keeps the roomier editorial measure. Evaluated once — it's a device trait.
  pageMargins: hasCoarsePointer() ? "narrow" : "wide",
  // Same device split: phones page one column at a time, desktop opens as a
  // two-page spread (the renderer already folds a spread to one column while
  // the viewport is portrait, so narrow desktop windows stay readable).
  readingMode: hasCoarsePointer() ? "paginated-single" : "paginated-double",
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
    if (isPluginRef(value)) return value;
  }
  return DEFAULT_READER_SETTINGS.fontFamily;
}

/** Coerce a persisted page-color preference to a valid value. */
export function normalizeReaderTheme(value: unknown): ReaderThemePreference {
  if (value === "auto" || value === "light" || value === "warm" || value === "dark") {
    return value;
  }
  if (isPluginRef(value)) return value;
  return DEFAULT_READER_PREFERENCES.theme;
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

/** Coerce a persisted page-margin preset to a valid value. */
export function normalizePageMargins(value: unknown): ReaderPageMargins {
  if (value === "narrow" || value === "medium" || value === "wide") return value;
  return DEFAULT_READER_SETTINGS.pageMargins;
}

/** Coerce a persisted alignment preset to a valid value. */
export function normalizeTextAlign(value: unknown): ReaderTextAlign {
  if (value === "book" || value === "start" || value === "justify") return value;
  return DEFAULT_READER_SETTINGS.textAlign;
}

/** Coerce a persisted font-weight preset to a valid value. */
export function normalizeFontWeight(value: unknown): ReaderFontWeight {
  if (value === "light" || value === "regular" || value === "medium" || value === "bold") {
    return value;
  }
  return DEFAULT_READER_SETTINGS.fontWeight;
}

export function getReaderPreferences(): ReaderSettingsPreferences {
  try {
    const raw = localKV.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_READER_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<ReaderSettingsPreferences>;
    return {
      theme: normalizeReaderTheme(parsed.theme),
      fontFamily: normalizeFontFamily(parsed.fontFamily),
      fontSize: normalizeFontSize(parsed.fontSize),
      fontWeight: normalizeFontWeight(parsed.fontWeight),
      lineSpacing: parsed.lineSpacing ?? DEFAULT_READER_PREFERENCES.lineSpacing,
      paragraphSpacing: parsed.paragraphSpacing ?? DEFAULT_READER_PREFERENCES.paragraphSpacing,
      pageMargins: normalizePageMargins(parsed.pageMargins),
      textAlign: normalizeTextAlign(parsed.textAlign),
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
