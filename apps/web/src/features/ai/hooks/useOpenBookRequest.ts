/**
 * Consumes openBookRequestAtom dispatches (chat book card clicks → open the
 * reader). Same pattern as the askAiRequestAtom consumers: track the last
 * handled id in a ref instead of clearing the atom, so re-dispatches always
 * fire and multiple consumers never race a clear.
 */
import { useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import type { LibraryBook } from "../../library/lib/library-types";
import { openBookRequestAtom } from "../state/chat-intent";

export function useOpenBookRequestHandler(
  books: LibraryBook[],
  openBook: (book: LibraryBook) => void,
  currentBookId: string | null,
): void {
  const request = useAtomValue(openBookRequestAtom);
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!request || handledRef.current === request.id) return;
    handledRef.current = request.id;
    // Already reading it (a book-thread card for the current book) — nothing to do.
    if (request.bookId === currentBookId) return;
    const book = books.find((candidate) => candidate.id === request.bookId);
    if (book) openBook(book);
  }, [request, books, openBook, currentBookId]);
}
