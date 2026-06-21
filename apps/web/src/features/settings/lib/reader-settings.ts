const STORAGE_KEY = "read-aware-reader-settings";

export type ReaderTheme = "light" | "warm" | "dark";
export type ReaderFontSize = "small" | "medium" | "large";
export type ReaderLineSpacing = "compact" | "comfortable" | "relaxed";
/**
 * How the book is laid out and navigated:
 * - `scroll` — continuous vertical scroll, lazily loading sections as you go.
 * - `paginated-single` — page turning, one column.
 * - `paginated-double` — page turning, two columns on a wide viewport.
 */
export type ReadingMode = "scroll" | "paginated-single" | "paginated-double";

export type ReaderSettings = {
  theme: ReaderTheme;
  fontSize: ReaderFontSize;
  lineSpacing: ReaderLineSpacing;
  readingMode: ReadingMode;
};

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: "warm",
  fontSize: "medium",
  lineSpacing: "comfortable",
  readingMode: "scroll",
};

export function getReaderSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_READER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return {
      theme: parsed.theme ?? DEFAULT_READER_SETTINGS.theme,
      fontSize: parsed.fontSize ?? DEFAULT_READER_SETTINGS.fontSize,
      lineSpacing: parsed.lineSpacing ?? DEFAULT_READER_SETTINGS.lineSpacing,
      readingMode: parsed.readingMode ?? DEFAULT_READER_SETTINGS.readingMode,
    };
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
}

export function saveReaderSettings(settings: ReaderSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
