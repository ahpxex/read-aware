import { AppError } from "./errors";

export const MAX_BOOK_REMOVAL_BATCH = 1_000;

export type BookRemovalCleanupQuery = { after?: string; limit?: number };
export type BookRemovalCleanupPage = {
  items: Array<{ bookId: string; title: string; removedAt: string }>;
  /** Live keyset pagination, not a frozen snapshot. */
  nextCursor: string | null;
};

export function normalizeBookRemovalCleanupQuery(input: BookRemovalCleanupQuery = {}): { after: string | null; limit: number } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError("library/invalid-cleanup-query", "Expected a cleanup query object");
  const limit = input.limit ?? 50, after = input.after ?? null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100
    || (after !== null && (typeof after !== "string" || !after.trim() || after.length > 256))) {
    throw new AppError("library/invalid-cleanup-query", "Expected limit 1-100 and an optional book ID cursor");
  }
  return { limit, after };
}

/** A committed batch is not rolled back if subsequent local blob release fails. */
export type BookFileReleaseReceipt = {
  bookIds: string[];
  files: { status: "released" } | { status: "pending"; errorCode: string };
};
export type BookRemovalReceipt = BookFileReleaseReceipt & {
  /** The record transaction committed. This is not a filesystem transaction. */
  committed: true;
};

export function normalizeBookRemovalIds(input: unknown): string[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_BOOK_REMOVAL_BATCH
    || Array.from(input).some(id => typeof id !== "string" || !id.trim() || id.length > 256)) {
    throw new AppError("library/invalid-removal", "Expected 1-1000 non-empty book IDs of at most 256 characters");
  }
  return [...new Set(input as string[])];
}
