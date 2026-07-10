/**
 * Hydrates book reference cards: bookId → live LibraryBook (cover data URL,
 * progress). A transcript can hold many stacks, so concurrent callers share one
 * in-flight listLibraryBooks() load. Returns null while loading; ids missing
 * from the map mean the book has left the shelf (cards fall back to their
 * persisted snapshot).
 */
import { useEffect, useState } from "react";
import { listLibraryBooks } from "../../library/lib/library-db";
import type { LibraryBook } from "../../library/lib/library-types";

let inFlight: Promise<LibraryBook[]> | null = null;

function loadShelfShared(): Promise<LibraryBook[]> {
  if (!inFlight) {
    inFlight = listLibraryBooks().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

export function useReferenceBooks(bookIds: string[]): Map<string, LibraryBook> | null {
  const [books, setBooks] = useState<Map<string, LibraryBook> | null>(null);
  const key = bookIds.join("\n");

  useEffect(() => {
    let alive = true;
    void loadShelfShared().then((shelf) => {
      if (!alive) return;
      const wanted = new Set(key.split("\n").filter(Boolean));
      setBooks(
        new Map(shelf.filter((book) => wanted.has(book.id)).map((book) => [book.id, book])),
      );
    });
    return () => {
      alive = false;
    };
  }, [key]);

  return books;
}
