import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { formatLibraryError } from "../lib/format-library-error";
import {
  importBookFile,
  listLibraryBooks,
  removeLibraryBook,
  setLibraryBookStarred,
} from "../lib/library-db";
import { createProgressPatch } from "../lib/library-progress";
import { canUseNativeFilePicker, pickBookFilesNative } from "../lib/pick-book-files";
import type { BookProgress, LibraryBook } from "../lib/library-types";

function formatImportNotice(imported: number, duplicates: string[]): string {
  const skipped =
    duplicates.length === 1
      ? `“${duplicates[0]}” is already in your library.`
      : `Skipped ${duplicates.length} books already in your library.`;
  return imported > 0 ? `${skipped} Imported ${imported} new.` : skipped;
}

export function useLibraryController() {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

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

  const importFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    setIsImporting(true);
    setLibraryError(null);
    setImportNotice(null);

    let imported = 0;
    const duplicates: string[] = [];
    try {
      for (const file of files) {
        const result = await importBookFile(file);
        if (result.status === "duplicate") duplicates.push(result.book.title);
        else imported += 1;
      }

      setBooks(await listLibraryBooks());
      if (duplicates.length > 0) {
        setImportNotice(formatImportNotice(imported, duplicates));
      }
    } catch (error) {
      reportError(error);
    } finally {
      setIsImporting(false);
    }
  }, [reportError]);

  const openImportPicker = useCallback(() => {
    // Desktop: the webview ignores the <input accept> filter, so drive the
    // native OS dialog (with a real Books format filter) instead. Web/dev falls
    // back to the hidden file input.
    if (canUseNativeFilePicker()) {
      void pickBookFilesNative().then(importFiles).catch(reportError);
      return;
    }

    importInputRef.current?.click();
  }, [importFiles, reportError]);

  const handleImportSelection = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";
    await importFiles(files);
  }, [importFiles]);

  const handleToggleStar = useCallback((book: LibraryBook) => {
    const nextStarred = !book.starred;
    // Optimistic: flip in state immediately so the shelf re-pins without waiting
    // on IndexedDB; roll back if the write fails.
    setBooks((currentBooks) =>
      currentBooks.map((entry) => (entry.id === book.id ? { ...entry, starred: nextStarred } : entry)),
    );
    void setLibraryBookStarred(book.id, nextStarred).catch((error) => {
      setBooks((currentBooks) =>
        currentBooks.map((entry) => (entry.id === book.id ? { ...entry, starred: book.starred } : entry)),
      );
      reportError(error);
    });
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
    libraryReady,
    libraryError,
    isImporting,
    importNotice,
    importInputRef,
    openImportPicker,
    handleImportSelection,
    handleRemoveBook,
    handleToggleStar,
    replaceBookInState,
    applyOptimisticProgress,
    reportError,
  };
}
