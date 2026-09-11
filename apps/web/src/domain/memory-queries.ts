import { AppError, normalizeMemoryQuery, type BookGraphQuery, type BookGraphResult, type ChapterDigest, type DigestFlavor, type MemoryQuery, type MemoryRecord } from "@read-aware/core";
import { normalizeBookGraphQuery, queryBookGraph, type BookGraphBoundary } from "@read-aware/agent";
import { normalizeMemoryPageQuery, type MemoryPageQuery, type MemoryPage } from "@read-aware/core";

export type MemoryQueries = {
  search(input: MemoryQuery): Promise<MemoryRecord[]>;
  page(input: MemoryPageQuery): Promise<MemoryPage>;
  bookGraph(bookId: string, query?: BookGraphQuery): Promise<BookGraphResult>;
};
export type MemoryQueryDeps = {
  search(input: MemoryQuery): Promise<MemoryRecord[]>;
  page(input: MemoryPageQuery): Promise<MemoryPage>;
  graph(bookId: string): Promise<{ digests: ChapterDigest[]; boundary: BookGraphBoundary; flavor?: DigestFlavor }>;
};

export function createMemoryQueries(deps: MemoryQueryDeps, lifetime?: AbortSignal): MemoryQueries {
  const assertLive = () => { if (lifetime?.aborted) throw new AppError("plugin/cancelled", "Memory query owner retired"); };
  return {
    page: async input => {
      assertLive();
      const page = await deps.page(normalizeMemoryPageQuery(input));
      assertLive();
      return structuredClone(page);
    },
    search: async input => {
      assertLive();
      const query = normalizeMemoryQuery(input);
      const rows = await deps.search(query);
      assertLive();
      return structuredClone(rows);
    },
    bookGraph: async (bookId, input = {}) => {
      assertLive();
      if (typeof bookId !== "string" || !bookId.trim() || bookId.length > 256) throw new AppError("memory/invalid-query", "Expected a book ID");
      const query = normalizeBookGraphQuery(input);
      const { digests, boundary, flavor } = await deps.graph(bookId);
      assertLive();
      return queryBookGraph(digests, query, boundary, flavor);
    },
  };
}
