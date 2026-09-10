import { AppError } from "./errors";
import { normalizeBookReferencesQuery } from "./book-references";
import type { ReadingLocation } from "./reading-session";

export type BookNavigationTargetsQuery = {
  bookId: string; contentVersion: string; kind: "sections" | "pages";
  offset?: number; limit?: number;
  /** Exact source page label, not a page index. Duplicate labels remain separate results. */
  label?: string;
};
export type BookNavigationTargetEntry = {
  index: number; sectionIndex: number | null;
  label: string | null; labelTruncated: boolean; linear: boolean | null;
  location: ReadingLocation | null;
};
export type BookNavigationTargetsPage = {
  bookId: string; contentVersion: string; kind: "sections" | "pages";
  status: "available" | "absent"; items: BookNavigationTargetEntry[];
  total: number; nextOffset: number | null;
};
export function normalizeBookNavigationTargetsQuery(value: BookNavigationTargetsQuery) {
  const invalid = () => new AppError("library/invalid-query", "Invalid navigation catalog query");
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !["bookId", "contentVersion", "kind", "offset", "limit", "label"].includes(key))
    || !["sections", "pages"].includes(value.kind)
    || value.label !== undefined && (value.kind !== "pages" || typeof value.label !== "string" || !value.label.trim() || value.label.length > 300)) throw invalid();
  const { sectionIndex: _sectionIndex, ...query } = normalizeBookReferencesQuery({ bookId: value.bookId,
    contentVersion: value.contentVersion, sectionIndex: 0, offset: value.offset, limit: value.limit });
  return { ...query, kind: value.kind, ...(value.label !== undefined ? { label: value.label } : {}) };
}
