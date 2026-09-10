import { AppError } from "@read-aware/core";

// Process-local invalidation fences, separate from hashes of actual content.
const revisions = new Map<string, string>();
const providerRevisions = new WeakMap<object, Map<string, string>>();

/** Provider registration identity matters even without an explicit invalidation. */
export function virtualSourceRevision(bookId: string, provider: object | null, key: string): string {
  if (!provider) return `${contentInvalidationRevision(bookId)}:unavailable`;
  let sources = providerRevisions.get(provider);
  if (!sources) { sources = new Map(); providerRevisions.set(provider, sources); }
  let revision = sources.get(key);
  if (!revision) { revision = crypto.randomUUID(); sources.set(key, revision); }
  return `${contentInvalidationRevision(bookId)}:${revision}`;
}

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
