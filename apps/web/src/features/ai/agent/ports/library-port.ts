/**
 * LibraryPort — the agent's BookOverview is a composition of two canonical
 * domain read models (BookSummary x BookStats), joined from Library and
 * Reading. Field names and semantics stay canonical (progressPercent 0..100).
 */
import type { BookOverview, LibraryPort } from "@read-aware/agent";
import type { BookStats, BookSummary, Id } from "@read-aware/core";
import { createDomainApi } from "../../../../domain";
import { commitDomainEvents } from "../../../../platform/domain-events";

function toOverview(book: BookSummary, state: BookStats | undefined): BookOverview {
  return {
    id: book.id as Id,
    title: book.title,
    author: book.author,
    format: book.format,
    starred: book.starred,
    collectionId: book.collectionId,
    progressPercent: state?.progressPercent,
    status: state?.status,
    narrativity: book.narrativity,
    addedAt: book.addedAt,
    updatedAt: book.updatedAt,
    lastOpenedAt: book.lastOpenedAt,
  };
}

export function createLibraryPort(): LibraryPort {
  const { library, reading } = createDomainApi("agent");

  const listOverviews = async (): Promise<BookOverview[]> => {
    const [summaries, states] = await Promise.all([
      library.queries.books.list(),
      reading.queries.stats.list(),
    ]);
    const stateByBook = new Map(states.map((state) => [state.bookId, state]));
    return summaries.map((book) => toOverview(book, stateByBook.get(book.id)));
  };

  return {
    listBooks: listOverviews,
    getBook: async (bookId) =>
      (await listOverviews()).find((book) => book.id === String(bookId)),
    listCollections: () => library.queries.collections.list(),
    booksInCollection: async (collectionId) =>
      (await library.queries.collections.booksIn(collectionId)).map((bookId) => bookId as Id),
    getBookStats: async (bookId) =>
      (await reading.queries.stats.forBook(String(bookId))) ?? undefined,
    listBookStats: () => reading.queries.stats.list(),
    getStatsOverview: () => reading.queries.stats.overview(),
    editBookMetadata: (bookId, patch) =>
      library.commands.books.editMetadata(String(bookId), patch),
    setBookStarred: (bookId, starred) =>
      library.commands.books.setStarred(String(bookId), starred),
    setBookFinished: (bookId, finished) =>
      reading.commands.setFinished(String(bookId), finished),
    // 管线接缝（与 book-memory-port 的 saveDigest 同构）：LLM 判定入事件流，
    // apply.rs 物化到 books.narrativity。
    setBookNarrativity: async (bookId, narrativity) => {
      await commitDomainEvents({
        type: "book.narrativityClassified",
        payload: { bookId: String(bookId) as Id, narrativity },
        origin: "agent",
      });
    },
    removeBook: (bookId) => library.commands.books.remove(String(bookId)),
    createCollection: (name) => library.commands.collections.create(name),
    renameCollection: (collectionId, name) =>
      library.commands.collections.rename(collectionId, name),
    removeCollection: (collectionId) => library.commands.collections.remove(collectionId),
    assignBooksToCollection: (bookIds, collectionId) =>
      library.commands.collections.assignBooks(bookIds.map(String), collectionId),
  };
}
