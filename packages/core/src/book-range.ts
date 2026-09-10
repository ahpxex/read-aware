import { AppError } from "./errors";
import type { ReadingTextQuote } from "./reading-session";

/** A content-versioned text range, not a DOM handle or an authorization token. */
export type BookTextRange = {
  bookId: string;
  contentVersion: string;
  cfi: string;
  /** Text-only sections (PDF) use a page CFI plus a disambiguating quote. */
  textQuote?: ReadingTextQuote;
};

export type BookRangeQuery = {
  range: BookTextRange;
  /** UTF-16 offsets in the resolved range, never in extracted chapter text. */
  offset?: number;
  limit?: number;
  contextChars?: number;
};
export type BookRangePage = {
  range: BookTextRange;
  sectionIndex: number;
  text: string;
  offset: number;
  totalLength: number;
  nextOffset: number | null;
  /** Bounded context outside the whole range, confined to the same section. */
  context: { before: string; after: string };
};

const invalid = () => new AppError("library/invalid-range", "Invalid versioned range or read bounds");
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw invalid();
  return value;
}
function integer(value: unknown, fallback: number, min: number, max: number): number {
  const number = value === undefined ? fallback : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < min || number > max) throw invalid();
  return number;
}
export function normalizeBookRangeQuery(value: unknown): Required<BookRangeQuery> {
  const input = object(value, ["range", "offset", "limit", "contextChars"]);
  const raw = object(input.range, ["bookId", "contentVersion", "cfi", "textQuote"]);
  const range: BookTextRange = { bookId: text(raw.bookId, 512), contentVersion: text(raw.contentVersion, 256), cfi: text(raw.cfi, 8192) };
  if (!/^epubcfi\(.+\)$/.test(range.cfi)) throw invalid();
  if (raw.textQuote !== undefined) {
    const quote = object(raw.textQuote, ["exact", "prefix", "suffix"]);
    range.textQuote = { exact: text(quote.exact, 12000) };
    for (const key of ["prefix", "suffix"] as const) if (quote[key] !== undefined) {
      if (typeof quote[key] !== "string" || quote[key].length > 2000) throw invalid();
      range.textQuote[key] = quote[key];
    }
  }
  return { range, offset: integer(input.offset, 0, 0, Number.MAX_SAFE_INTEGER),
    limit: integer(input.limit, 4000, 2, 12000), contextChars: integer(input.contextChars, 240, 0, 2000) };
}
