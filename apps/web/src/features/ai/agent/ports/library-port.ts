/** LibraryPort over the product library store（doc §5 端口在产品侧的实现）。 */
import type { BookOverview, LibraryPort } from "@read-aware/agent";
import type { Id } from "@read-aware/core";
import { listLibraryBooks } from "../../../library/lib/library-db";
import type { LibraryBook } from "../../../library/lib/library-types";

function toOverview(book: LibraryBook): BookOverview {
  return {
    id: book.id as Id,
    title: book.title,
    author: book.author || undefined,
    progressFraction: (book.progressPercent ?? 0) / 100,
    addedAt: book.createdAt,
    lastOpenedAt: book.lastOpenedAt ?? undefined,
  };
}

export function createLibraryPort(): LibraryPort {
  return {
    listBooks: async () => (await listLibraryBooks()).map(toOverview),
    getBook: async (bookId) => {
      const book = (await listLibraryBooks()).find((entry) => entry.id === String(bookId));
      return book ? toOverview(book) : undefined;
    },
  };
}
