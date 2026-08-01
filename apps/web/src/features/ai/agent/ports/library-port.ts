/**
 * LibraryPort — the agent's BookOverview is a composition of two canonical
 * domain read models (BookSummary × BookStats), joined here from the shelf
 * domain. Field names and semantics stay canonical (progressPercent 0..100).
 */
import type { BookOverview, LibraryPort } from "@read-aware/agent";
import type { BookStats, BookSummary, Id } from "@read-aware/core";
import { createShelfDomain } from "../../../../domain";

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
    addedAt: book.addedAt,
    updatedAt: book.updatedAt,
    lastOpenedAt: book.lastOpenedAt,
  };
}

export function createLibraryPort(): LibraryPort {
  const shelf = createShelfDomain("agent");

  const listOverviews = async (): Promise<BookOverview[]> => {
    const [summaries, states] = await Promise.all([shelf.books.list(), shelf.stats.list()]);
    const stateByBook = new Map(states.map((state) => [state.bookId, state]));
    return summaries.map((book) => toOverview(book, stateByBook.get(book.id)));
  };

  return {
    listBooks: listOverviews,
    getBook: async (bookId) =>
      (await listOverviews()).find((book) => book.id === String(bookId)),
    listCollections: () => shelf.collections.list(),
    booksInCollection: async (collectionId) =>
      (await shelf.collections.booksIn(collectionId)).map((bookId) => bookId as Id),
    getBookStats: async (bookId) => (await shelf.stats.forBook(String(bookId))) ?? undefined,
    listBookStats: () => shelf.stats.list(),
    getStatsOverview: () => shelf.stats.overview(),
    editBookMetadata: (bookId, patch) => shelf.books.editMetadata(String(bookId), patch),
    setBookStarred: (bookId, starred) => shelf.books.setStarred(String(bookId), starred),
    setBookFinished: (bookId, finished) => shelf.books.setFinished(String(bookId), finished),
    removeBook: (bookId) => shelf.books.remove(String(bookId)),
    createCollection: (name) => shelf.collections.create(name),
    renameCollection: (collectionId, name) => shelf.collections.rename(collectionId, name),
    removeCollection: (collectionId) => shelf.collections.remove(collectionId),
    assignBooksToCollection: (bookIds, collectionId) =>
      shelf.collections.assignBooks(bookIds.map(String), collectionId),
  };
}
