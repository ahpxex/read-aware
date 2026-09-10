import { AppError } from "./errors";
import type { ReadingLocation } from "./reading-session";

export type BookReference = { bookId: string; contentVersion: string; sectionIndex: number; index: number };
export type BookReferencesQuery = { bookId: string; contentVersion: string; sectionIndex: number; offset?: number; limit?: number };
export type BookReferencesPage = {
  bookId: string; contentVersion: string; sectionIndex: number;
  status: "available" | "unsupported";
  items: { reference: BookReference; label: string; kind: "link" | "inline-note" }[];
  total: number; nextOffset: number | null;
};
export type BookReferenceQuery = { reference: BookReference; offset?: number; limit?: number };
export type BookReferencePreview = {
  reference: BookReference;
  status: "resolved" | "external" | "blocked" | "missing" | "unsupported";
  label: string;
  /** Only a resolved internal target; never an untrusted href to execute. */
  location?: ReadingLocation;
  /** HTTP(S) only; returned for inspection, never fetched or opened by this query. */
  url?: string;
  text: string; offset: number; totalLength: number; nextOffset: number | null;
};

const invalid = () => new AppError("library/invalid-query", "Invalid book reference or pagination");
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}
function string(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw invalid();
  return value;
}
function integer(value: unknown, fallback: number | undefined, min: number, max: number): number {
  const number = value === undefined ? fallback : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < min || number > max) throw invalid();
  return number;
}
function source(raw: Record<string, unknown>) {
  return { bookId: string(raw.bookId, 512), contentVersion: string(raw.contentVersion, 256),
    sectionIndex: integer(raw.sectionIndex, undefined, 0, Number.MAX_SAFE_INTEGER) };
}
export function normalizeBookReferencesQuery(value: unknown): Required<BookReferencesQuery> {
  const raw = object(value, ["bookId", "contentVersion", "sectionIndex", "offset", "limit"]);
  return { ...source(raw), offset: integer(raw.offset, 0, 0, Number.MAX_SAFE_INTEGER), limit: integer(raw.limit, 20, 1, 50) };
}
export function normalizeBookReferenceQuery(value: unknown): Required<BookReferenceQuery> {
  const raw = object(value, ["reference", "offset", "limit"]);
  const ref = object(raw.reference, ["bookId", "contentVersion", "sectionIndex", "index"]);
  return { reference: { ...source(ref), index: integer(ref.index, undefined, 0, Number.MAX_SAFE_INTEGER) },
    offset: integer(raw.offset, 0, 0, Number.MAX_SAFE_INTEGER), limit: integer(raw.limit, 4000, 2, 12000) };
}
