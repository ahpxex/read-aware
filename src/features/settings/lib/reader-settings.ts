const STORAGE_KEY = "read-aware-reader-settings";

export type ReaderTheme = "light" | "warm" | "dark";
export type ReaderFontSize = "small" | "medium" | "large";
export type ReaderLineSpacing = "compact" | "comfortable" | "relaxed";

export type ReaderSettings = {
  theme: ReaderTheme;
  fontSize: ReaderFontSize;
  lineSpacing: ReaderLineSpacing;
};

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: "warm",
  fontSize: "medium",
  lineSpacing: "comfortable",
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
    };
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
}

export function saveReaderSettings(settings: ReaderSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
