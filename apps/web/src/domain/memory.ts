import { AppError, type EventOrigin } from "@read-aware/core";
import { createBookMemoryPort } from "../features/ai/agent/ports/book-memory-port";
import { createMemoryPort } from "../features/ai/agent/ports/memory-port";
import { getBookRecord } from "../features/library/lib/library-db";
import { getPersistedBookText } from "../features/library/lib/book-text-store";
import { readingRuntime } from "./reading-runtime";
import { createMemoryQueries } from "./memory-queries";
import { bookMemoryBoundary } from "./book-memory-boundary";

/** Memory reads do not import books, construct digests, or grant raw projection writes. */
export function createMemoryDomain(_origin: EventOrigin, lifetime?: AbortSignal) {
  const memory = createMemoryPort(), bookMemory = createBookMemoryPort();
  const queries = createMemoryQueries({ search: memory.searchMemories, graph: async bookId => {
    const digests = await bookMemory.listDigests(bookId);
    const chapters = await getPersistedBookText(bookId);
    const book = await getBookRecord(bookId);
    if (!book) throw new AppError("reader/book-not-found", "Book not found");
    const boundary = bookMemoryBoundary(book, readingRuntime.snapshot(), chapters?.map((chapter, index) => ({ index, hrefs: chapter.hrefs })) ?? null);
    return { digests, boundary, flavor: book.narrativity ?? undefined };
  } }, lifetime);
  return { queries, commands: {}, events: {} };
}
