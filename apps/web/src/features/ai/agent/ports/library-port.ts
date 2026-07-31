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
    progressPercent: state?.progressPercent,
    status: state?.status,
    addedAt: book.addedAt,
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
  };
}
