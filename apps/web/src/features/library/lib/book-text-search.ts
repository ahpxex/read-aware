import { AppError, searchChapters, type BookTextSearch, type BookTextHit, type ChapterLike } from "@read-aware/core";

export interface BookTextSearchSource {
  list(): Promise<{ id: string }[]>;
  extract(bookId: string): Promise<ChapterLike[]>;
  persisted(bookId: string): Promise<ChapterLike[] | null>;
}

function validate(input: BookTextSearch): Required<Pick<BookTextSearch, "queries" | "limit">> & BookTextSearch {
  if (!input || !Array.isArray(input.queries) || input.queries.length < 1 || input.queries.length > 12
    || input.queries.some(q => typeof q !== "string" || !q.trim() || q.length > 1024)
    || (input.bookId !== undefined && (typeof input.bookId !== "string" || !input.bookId.trim()))
    || (input.throughChapterIndex !== undefined && (!Number.isSafeInteger(input.throughChapterIndex) || input.throughChapterIndex < -1 || !input.bookId))
    || (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100))) {
    throw new AppError("library/invalid-query", "Invalid derived-text search queries, book, chapter ceiling, or result limit");
  }
  return { ...input, queries: [...new Set(input.queries.map(q => q.trim()))], limit: input.limit ?? 16 };
}

/** One implementation for Agent ports and permission-gated plugin queries. */
export async function searchBookText(source: BookTextSearchSource, raw: BookTextSearch, signal?: AbortSignal): Promise<BookTextHit[]> {
  const input = validate(raw);
  const active = () => { if (signal?.aborted) throw new AppError("library/cancelled", "Book text search was cancelled"); };
  active();
  if (input.bookId) {
    const chapters = await source.extract(input.bookId);
    active();
    return searchChapters(input.throughChapterIndex === undefined ? chapters : chapters.slice(0, input.throughChapterIndex + 1), input.queries, input.limit)
      .map(hit => ({ ...hit, bookId: input.bookId! }));
  }
  const books = await source.list();
  active();
  const results: BookTextHit[] = [];
  for (const book of books) {
    const chapters = await source.persisted(book.id);
    active();
    if (!chapters) continue;
    results.push(...searchChapters(chapters, input.queries, input.limit - results.length).map(hit => ({ ...hit, bookId: book.id })));
    if (results.length >= input.limit) break;
  }
  return results;
}
