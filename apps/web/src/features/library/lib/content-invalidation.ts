import { AppError } from "@read-aware/core";

// Process-local invalidation fences, separate from hashes of actual content.
const revisions = new Map<string, string>();

export function contentInvalidationRevision(bookId: string): string {
  return revisions.get(bookId) ?? "initial";
}

export function invalidateBookContent(bookId: string): string {
  const revision = crypto.randomUUID();
  revisions.set(bookId, revision);
  return revision;
}

export function assertContentNotInvalidated(bookId: string, revision: string): void {
  if (contentInvalidationRevision(bookId) !== revision) {
    throw new AppError("reader/stale-location", "Book content was invalidated during access");
  }
}
