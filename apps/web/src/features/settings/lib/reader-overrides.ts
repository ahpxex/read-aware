import {
  DEFAULT_READER_PREFERENCES,
  normalizeFontFamily,
  normalizeFontSize,
  normalizeFontWeight,
  type ReaderSettingsPreferences,
} from "./reader-settings";

import { localKV } from "../../../platform/local-store";

const STORAGE_KEY = "read-aware-reader-overrides";

/**
 * Whether a book renders with the global reading settings (`global`) or with its
 * own per-book settings (`book`). The active scope decides where edits made in
 * the in-reader appearance popover are written.
 */
export type ReaderAppearanceScope = "global" | "book";

/**
 * A single book's appearance override. `settings` is always kept (even while the
 * scope is `global`) so toggling back to `book` restores the prior choices
 * instead of re-seeding from the global defaults.
 */
export type BookReaderOverride = {
  scope: ReaderAppearanceScope;
  settings: ReaderSettingsPreferences;
};

/** Per-book overrides keyed by library book id. */
export type ReaderOverrides = Record<string, BookReaderOverride>;

function normalizeSettings(
  value: Partial<ReaderSettingsPreferences> | undefined,
): ReaderSettingsPreferences {
  const merged = { ...DEFAULT_READER_PREFERENCES, ...(value ?? {}) };
  // Coerce the fields whose representation has changed so legacy overrides
  // (named font sizes, sans/serif presets) keep resolving.
  return {
    ...merged,
    fontFamily: normalizeFontFamily(merged.fontFamily),
    fontSize: normalizeFontSize(merged.fontSize),
    fontWeight: normalizeFontWeight(merged.fontWeight),
  };
}

export function getReaderOverrides(): ReaderOverrides {
  try {
    const raw = localKV.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<BookReaderOverride>>;
    if (!parsed || typeof parsed !== "object") return {};

    const result: ReaderOverrides = {};
    for (const [bookId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      result[bookId] = {
        scope: value.scope === "book" ? "book" : "global",
        settings: normalizeSettings(value.settings),
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function saveReaderOverrides(overrides: ReaderOverrides): void {
  localKV.setItem(STORAGE_KEY, JSON.stringify(overrides));
}
