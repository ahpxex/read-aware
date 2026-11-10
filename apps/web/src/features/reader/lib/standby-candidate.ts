import type { LibraryBook } from "../../library";

/**
 * The book to keep ready in the reader while the shelf is showing: the one
 * read most recently, which is the one most often opened next. Plugin-provided
 * books are left out (their content is resolved by each opening), as are the
 * ones already tried (a book that could not be made ready is not tried again
 * every time the shelf settles).
 */
export function standbyCandidate(books: readonly LibraryBook[], tried: ReadonlySet<string>): LibraryBook | null {
  let latest: LibraryBook | null = null;
  for (const book of books) {
    if (!book.lastOpenedAt || book.format === "virtual" || tried.has(book.id)) continue;
    if (!latest || book.lastOpenedAt > latest.lastOpenedAt!) latest = book;
  }
  return latest;
}
