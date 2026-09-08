import { AppError } from "./errors";
import type { AnnotationItem } from "./read-models";

export type AnnotationPageQuery = {
  bookId?: string;
  kind?: AnnotationItem["kind"];
  query?: string;
  /** 1..100 rows; defaults to 20. */
  limit?: number;
  /** Opaque bookmark bound to bookId, kind and normalized query, not a grant. */
  cursor?: string;
};
export type AnnotationPage = {
  items: AnnotationItem[];
  nextCursor: string | null;
  /**
   * Newest first by createdAt/id. Each page reads current storage, not a frozen
   * export snapshot. Deleting the boundary row does not invalidate its cursor;
   * edits can change filter membership behind it. Restart to see newer rows.
   */
  consistency: "live";
};

export function normalizeAnnotationPageQuery(input: AnnotationPageQuery = {}): AnnotationPageQuery & { limit: number } {
  const invalid = () => new AppError("annotations/invalid-input", "Invalid annotation page query");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid();
  if (input.bookId !== undefined && (typeof input.bookId !== "string" || !input.bookId.trim() || input.bookId.length > 512)) throw invalid();
  if (input.kind !== undefined && !["highlight", "note", "ask"].includes(input.kind)) throw invalid();
  if (input.query !== undefined && (typeof input.query !== "string" || input.query.length > 500)) throw invalid();
  if (input.cursor !== undefined && (typeof input.cursor !== "string" || !input.cursor || input.cursor.length > 8192)) {
    throw new AppError("annotations/invalid-cursor", "Invalid annotation page cursor");
  }
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid();
  return { bookId: input.bookId, kind: input.kind, query: input.query?.trim() || undefined, limit, cursor: input.cursor };
}
