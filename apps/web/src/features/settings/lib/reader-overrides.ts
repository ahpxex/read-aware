import {
  DEFAULT_READER_PREFERENCES,
  normalizeCustomTypography,
  normalizeFontFamily,
  normalizeFontSize,
  normalizeFontWeight,
  normalizeReaderTheme,
  normalizeTextIndent,
  normalizeTypographyMode,
  type ReaderSettingsPreferences,
} from "./reader-settings";

import { localKV } from "../../../platform/local-store";
import type { DomainActor } from "../../../platform/domain-actor";

export const READER_OVERRIDES_KEY = "read-aware-reader-overrides";
const STORAGE_KEY = READER_OVERRIDES_KEY;

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

function normalizeSettings(value: Partial<ReaderSettingsPreferences> | undefined): ReaderSettingsPreferences {
  const merged = { ...DEFAULT_READER_PREFERENCES, ...value };
  // Coerce the fields whose representation has changed so legacy overrides
  // (named font sizes, sans/serif presets) keep resolving.
  return {
    ...merged,
    theme: normalizeReaderTheme(merged.theme),
    fontFamily: normalizeFontFamily(merged.fontFamily),
    fontSize: normalizeFontSize(merged.fontSize),
    fontWeight: normalizeFontWeight(merged.fontWeight),
    textIndent: normalizeTextIndent(merged.textIndent),
    typographyMode: normalizeTypographyMode(merged.typographyMode),
    customTypography: normalizeCustomTypography(merged.customTypography),
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

export function saveReaderOverrides(overrides: ReaderOverrides, origin: DomainActor = "user"): void {
  localKV.setItem(STORAGE_KEY, JSON.stringify(overrides), "local", origin);
}
