/**
 * Bookmarks: a named place in a book the reader wants to return to.
 *
 * Unlike an annotation (an anchored passage with text), a bookmark is a
 * reading target — a CFI, a section href or a book fraction, recorded against
 * the content version it was taken from. `selection` bookmarks keep the
 * selected range (always a CFI); `location` bookmarks keep where the page was.
 *
 * Bookmarks are library data: `bookmark.*` events project the `bookmarks`
 * table and roam with the event log. Native storage re-checks the same shape
 * (crates/store/src/storage/bookmarks.rs).
 */
import { AppError } from "./errors";
import type { ReadingLocation, ReadingTextQuote } from "./reading-session";

export type BookmarkKind = "location" | "selection";

/** Where a bookmark leads — a reading location without its book id (the
 * bookmark's own `bookId` owns that, and follows book merges). */
export type BookmarkTarget = {
  contentVersion: string;
  cfi?: string;
  href?: string;
  fraction?: number;
  textQuote?: ReadingTextQuote;
};

export type Bookmark = {
  id: string;
  bookId: string;
  name: string;
  kind: BookmarkKind;
  target: BookmarkTarget;
  createdAt: string;
  updatedAt: string;
};

export const BOOKMARK_NAME_MAX = 120;
const CONTENT_VERSION_MAX = 1024;
const LOCATOR_MAX = 8192;
const QUOTE_EXACT_MAX = 12000;
const QUOTE_CONTEXT_MAX = 2000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const nonBlank = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

/** A display name: trimmed, 1..120 characters, single line. */
export function normalizeBookmarkName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/gu, " ").trim();
  return name && name.length <= BOOKMARK_NAME_MAX ? name : null;
}

/**
 * The canonical target, or null when the shape is not one a bookmark can
 * hold: exactly one of `cfi` / `href` / `fraction` (0..1), an optional text
 * quote, and a `selection` bookmark must carry a CFI. Unknown keys (including
 * a `bookId`) are dropped by construction.
 */
export function normalizeBookmarkTarget(raw: unknown, kind: BookmarkKind): BookmarkTarget | null {
  if (!isObject(raw) || !nonBlank(raw.contentVersion, CONTENT_VERSION_MAX)) return null;
  const target: BookmarkTarget = { contentVersion: raw.contentVersion };
  const locators = (["cfi", "href", "fraction"] as const).filter((key) => raw[key] !== undefined);
  if (locators.length !== 1) return null;
  const [locator] = locators;
  if (locator === "fraction") {
    const fraction = raw.fraction;
    if (typeof fraction !== "number" || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) return null;
    target.fraction = fraction;
  } else {
    const value = raw[locator];
    if (!nonBlank(value, LOCATOR_MAX)) return null;
    target[locator] = value;
  }
  if (kind === "selection" && target.cfi === undefined) return null;
  if (raw.textQuote !== undefined) {
    const quote = raw.textQuote;
    if (!isObject(quote) || !nonBlank(quote.exact, QUOTE_EXACT_MAX)) return null;
    const textQuote: ReadingTextQuote = { exact: quote.exact };
    for (const key of ["prefix", "suffix"] as const) {
      if (quote[key] === undefined) continue;
      if (typeof quote[key] !== "string" || quote[key].length > QUOTE_CONTEXT_MAX) return null;
      textQuote[key] = quote[key];
    }
    target.textQuote = textQuote;
  }
  return target;
}

export function isBookmarkKind(value: unknown): value is BookmarkKind {
  return value === "location" || value === "selection";
}

/** The reading location a bookmark opens. */
export function bookmarkLocation(bookmark: Pick<Bookmark, "bookId" | "target">): ReadingLocation {
  return { bookId: bookmark.bookId, ...structuredClone(bookmark.target) };
}

/**
 * The target a reading location is stored as: its most precise locator
 * (CFI, else section href, else fraction), or an invalid-input error. A
 * session location carries several at once; a bookmark keeps one.
 */
export function bookmarkTargetFrom(location: ReadingLocation, kind: BookmarkKind): BookmarkTarget {
  const locator =
    location.cfi !== undefined
      ? { cfi: location.cfi }
      : location.href !== undefined
        ? { href: location.href }
        : { fraction: location.fraction };
  const target = normalizeBookmarkTarget(
    {
      contentVersion: location.contentVersion,
      ...locator,
      ...(location.textQuote ? { textQuote: location.textQuote } : {}),
    },
    kind,
  );
  if (!target) throw new AppError("bookmarks/invalid-input", "This location cannot be bookmarked");
  return target;
}
