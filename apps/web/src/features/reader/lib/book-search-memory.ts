/**
 * What the book search remembers between openings, per book.
 *
 * The query is device-local presentation state (like `toc-folds`): it is kept
 * in local KV, so it outlives a restart, but it does not roam and has no
 * events. The reader shell remounts on every book open, and the search panel
 * on every opening, so none of this can live in component state.
 *
 * What the query found, the chapter names its text hits are listed under, and
 * where the result list was scrolled are kept in memory for this run of the
 * app only: reopening the search then shows the same list at the same place
 * without searching the book again. After a restart the remembered query
 * simply searches anew.
 */
import { localKV } from "../../../platform/local-store";

export const bookSearchKey = (bookId: string) => `read-aware-book-search:${bookId}`;

export function parseSearchQuery(raw: string | null): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { query?: unknown };
    return typeof parsed?.query === "string" ? parsed.query : "";
  } catch {
    // A malformed value only loses the remembered query; the field opens empty.
    return "";
  }
}

export function readSearchQuery(bookId: string): string {
  return parseSearchQuery(localKV.getItem(bookSearchKey(bookId)));
}

/**
 * Remember the query (an empty one forgets it). Resolves once durable; on
 * failure the local store rolls the value back and reports it through
 * `local-write-failed`.
 */
export function writeSearchQuery(bookId: string, query: string): Promise<void> {
  const key = bookSearchKey(bookId);
  if (!query) return localKV.getItem(key) === null ? Promise.resolve() : localKV.removeItemAsync(key, "user");
  if (readSearchQuery(bookId) === query) return Promise.resolve();
  return localKV.setItemAsync(key, JSON.stringify({ query }), "user");
}

/** A small map that forgets its least recently used entries past a size. */
class RecentMap<K, V> {
  private readonly entries = new Map<K, V>();
  constructor(private readonly limit: number) {}
  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }
  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.limit) break;
      this.entries.delete(oldest);
    }
  }
  clear(): void {
    this.entries.clear();
  }
}

/** Keeps a few books' worth: each entry can hold hundreds of text hits. */
const RESULT_LIMIT = 12;
const BOOK_LIMIT = 12;

/**
 * This run's memory of finished searches, the books' chapter names for text
 * hits, and where each book's result list was left. `T` is the search hook's
 * result shape; this module does not need to know it.
 */
export function createSearchSession<T>() {
  const results = new RecentMap<string, T>(RESULT_LIMIT);
  const chapters = new RecentMap<string, (sectionIndex: number) => string | undefined>(BOOK_LIMIT);
  const places = new RecentMap<string, { query: string; row: string }>(BOOK_LIMIT);
  const resultKey = (bookId: string, query: string) => `${bookId}\u0000${query}`;
  return {
    results: {
      get: (bookId: string, query: string) => results.get(resultKey(bookId, query)),
      set: (bookId: string, query: string, value: T) => results.set(resultKey(bookId, query), value),
    },
    chapters: {
      get: (bookId: string) => chapters.get(bookId),
      set: (bookId: string, of: (sectionIndex: number) => string | undefined) => chapters.set(bookId, of),
    },
    /** The row at the top of the result list, for the query it was showing. */
    place: {
      get: (bookId: string, query: string) => {
        const place = places.get(bookId);
        return place?.query === query ? place.row : undefined;
      },
      set: (bookId: string, query: string, row: string) => places.set(bookId, { query, row }),
    },
    clear: () => {
      results.clear();
      chapters.clear();
      places.clear();
    },
  };
}
