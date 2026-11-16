import type { Highlight, Note } from "./annotation-types";

export type Mark = Highlight | Note;

/** One book's marks, newest first; `book` is null when the book has left the library. */
export type BookMarks<TBook> = { bookId: string; book: TBook | null; marks: Mark[] };

/**
 * Marks by book, for the highlights & notes page: the most recently marked
 * book first, each book's marks newest first. The list comes from the marks
 * themselves, not the library, so a book removed since still shows its marks
 * (with `book` null) rather than dropping them from view.
 */
export function groupMarksByBook<TBook extends { id: string }>(
  marks: readonly Mark[],
  books: readonly TBook[],
): BookMarks<TBook>[] {
  const library = new Map(books.map((book) => [book.id, book]));
  const groups = new Map<string, BookMarks<TBook>>();
  const newestFirst = [...marks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const mark of newestFirst) {
    let group = groups.get(mark.bookId);
    if (!group) {
      group = { bookId: mark.bookId, book: library.get(mark.bookId) ?? null, marks: [] };
      groups.set(mark.bookId, group);
    }
    group.marks.push(mark);
  }
  return [...groups.values()];
}
