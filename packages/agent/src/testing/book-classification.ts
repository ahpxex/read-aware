import { AppError, normalizeBookClassification, validateClassificationBookId, type BookClassificationSnapshot } from "@read-aware/core";
import type { BookOverview, RuntimeDeps } from "../ports";

/** Native event identity/ABA is tested in Rust; this fixture observes test-row edits. */
export function createBookClassificationFixture(books: BookOverview[]): RuntimeDeps["bookClassification"] {
  const versions = new Map<string, { flavor: BookOverview["narrativity"]; revision: string }>();
  const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new AppError("memory/cancelled", "Cancelled"); };
  const inspect = async (bookId: string, signal?: AbortSignal): Promise<BookClassificationSnapshot | null> => {
    validateClassificationBookId(bookId); cancelled(signal);
    const book = books.find(book => book.id === bookId);
    if (!book) return null;
    let version = versions.get(bookId);
    if (!version || version.flavor !== book.narrativity) {
      version = { flavor: book.narrativity, revision: `bcl1:${Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("")}` };
      versions.set(bookId, version);
    }
    return { bookId, narrativity: book.narrativity ?? null, revision: version.revision };
  };
  return { inspect, change: async (input, signal) => {
    const change = normalizeBookClassification(input), snapshot = await inspect(change.bookId, signal);
    cancelled(signal);
    if (!snapshot) throw new AppError("reader/book-not-found", "Book not found");
    if (snapshot.revision !== change.expectedRevision) throw new AppError("memory/conflict", "Classification changed");
    books.find(book => book.id === change.bookId)!.narrativity = change.narrativity;
    versions.delete(change.bookId);
    return { changed: true, snapshot: (await inspect(change.bookId))! };
  } };
}
