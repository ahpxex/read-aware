const STORAGE_KEY = "read-aware-reader-settings";

/** Concrete, render-ready page color. */
export type ReaderTheme = "light" | "warm" | "dark";
/** Stored page-color preference — `auto` follows the resolved app theme. */
export type ReaderThemePreference = ReaderTheme | "auto";
export type ReaderFontFamily = "sans" | "serif";
export type ReaderFontSize = "x-small" | "small" | "medium" | "large" | "x-large";
export type ReaderLineSpacing = "compact" | "comfortable" | "relaxed";
export type ReaderParagraphSpacing = "tight" | "normal" | "loose";
export type ReaderContentWidth = "narrow" | "medium" | "wide";
export type ReaderMargins = "compact" | "normal" | "spacious";
export type ReaderTextAlign = "start" | "justify";
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
  contentWidth: ReaderContentWidth;
  margins: ReaderMargins;
  textAlign: ReaderTextAlign;
  readingMode: ReadingMode;
};

/** Persisted reader preferences. Differs only in that `theme` may be `auto`. */
export type ReaderSettingsPreferences = Omit<ReaderSettings, "theme"> & {
  theme: ReaderThemePreference;
};

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: "warm",
  fontFamily: "sans",
  fontSize: "medium",
  lineSpacing: "comfortable",
  paragraphSpacing: "normal",
  contentWidth: "medium",
  margins: "normal",
  textAlign: "start",
  readingMode: "scroll",
};

export const DEFAULT_READER_PREFERENCES: ReaderSettingsPreferences = {
  ...DEFAULT_READER_SETTINGS,
  theme: "warm",
};

export function getReaderPreferences(): ReaderSettingsPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_READER_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<ReaderSettingsPreferences>;
    return {
      theme: parsed.theme ?? DEFAULT_READER_PREFERENCES.theme,
      fontFamily: parsed.fontFamily ?? DEFAULT_READER_PREFERENCES.fontFamily,
      fontSize: parsed.fontSize ?? DEFAULT_READER_PREFERENCES.fontSize,
      lineSpacing: parsed.lineSpacing ?? DEFAULT_READER_PREFERENCES.lineSpacing,
      paragraphSpacing: parsed.paragraphSpacing ?? DEFAULT_READER_PREFERENCES.paragraphSpacing,
      contentWidth: parsed.contentWidth ?? DEFAULT_READER_PREFERENCES.contentWidth,
      margins: parsed.margins ?? DEFAULT_READER_PREFERENCES.margins,
      textAlign: parsed.textAlign ?? DEFAULT_READER_PREFERENCES.textAlign,
      readingMode: parsed.readingMode ?? DEFAULT_READER_PREFERENCES.readingMode,
    };
  } catch {
    return DEFAULT_READER_PREFERENCES;
  }
}

export function saveReaderPreferences(prefs: ReaderSettingsPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
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
