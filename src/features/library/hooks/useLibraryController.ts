import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { deriveShelfSections } from "../lib/derive-shelf-sections";
import { formatLibraryError } from "../lib/format-library-error";
import {
  importBookFile,
  listLibraryBooks,
  removeLibraryBook,
} from "../lib/library-db";
import { createProgressPatch } from "../lib/library-progress";
import type { BookProgress, LibraryBook } from "../lib/library-types";

export function useLibraryController() {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const shelfSections = deriveShelfSections(books);

  const reportError = useCallback((error: unknown) => {
    setLibraryError(formatLibraryError(error));
  }, []);

  const replaceBookInState = useCallback((nextBook: LibraryBook) => {
    setBooks((currentBooks) => {
      const hasMatch = currentBooks.some((book) => book.id === nextBook.id);
      if (!hasMatch) return [nextBook, ...currentBooks];

      return currentBooks.map((book) => (
        book.id === nextBook.id ? nextBook : book
      ));
    });
  }, []);

  const applyOptimisticProgress = useCallback((bookId: string, progress: BookProgress) => {
    const timestamp = new Date().toISOString();

    setBooks((currentBooks) => currentBooks.map((book) => (
      book.id === bookId ? createProgressPatch(book, progress, timestamp) : book
    )));
  }, []);

  const loadLibrary = useCallback(async () => {
    try {
      setLibraryError(null);
      setBooks(await listLibraryBooks());
    } catch (error) {
      reportError(error);
    } finally {
      setLibraryReady(true);
    }
  }, [reportError]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const openImportPicker = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportSelection = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    if (files.length === 0) return;

    setIsImporting(true);
    setLibraryError(null);

    try {
      for (const file of files) {
        await importBookFile(file);
      }

      setBooks(await listLibraryBooks());
    } catch (error) {
      reportError(error);
    } finally {
      setIsImporting(false);
      event.currentTarget.value = "";
    }
  }, [reportError]);

  const handleRemoveBook = useCallback((book: LibraryBook) => {
    void removeLibraryBook(book.id)
      .then(() => {
        setBooks((currentBooks) => currentBooks.filter((entry) => entry.id !== book.id));
      })
      .catch((error) => {
        reportError(error);
      });
  }, [reportError]);

  return {
    books,
    shelfSections,
    libraryReady,
    libraryError,
    isImporting,
    importInputRef,
    openImportPicker,
    handleImportSelection,
    handleRemoveBook,
    replaceBookInState,
    applyOptimisticProgress,
    reportError,
  };
}
