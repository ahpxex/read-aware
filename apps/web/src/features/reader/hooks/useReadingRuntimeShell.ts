import { useEffect } from "react";
import { AppError } from "@read-aware/core";
import { readingRuntime } from "../../../domain/reading-runtime";
import { listLibraryBooks } from "../../library/lib/library-db";
import type { LibraryBook } from "../../library/lib/library-types";

export function useReadingRuntimeShell(open: (book: LibraryBook, intent?: number, options?: { resetPosition: true }) => void, close: () => void | Promise<void>): void {
  useEffect(() => readingRuntime.bindShell({
    open: async (bookId, intent, options) => {
      const book = (await listLibraryBooks()).find(book => book.id === bookId);
      if (!book) throw new AppError("reader/book-not-found", "Requested book is not in the library");
      open(book, intent, options);
    },
    close,
  }), [open, close]);
}
