import { useCallback, useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { onAppEvent } from "../../../platform/app-events";
import { scheduleCatchUpEnrichment } from "../lib/book-enrichment";
import { getBookRecord, listCollections, listLibraryBooks } from "../lib/library-db";
import { createProgressPatch } from "../lib/library-progress";
import type { BookProgress, LibraryBook } from "../lib/library-types";
import {
  libraryBooksAtom,
  libraryCollectionsAtom,
  libraryReadyAtom,
  patchBook,
  removeBooks,
  upsertBook,
} from "../state/library-store";

type LibraryStoreOptions = {
  reportError: (error: unknown) => void;
};

/**
 * Loads the shelf and keeps it current:
 * - a full reload at mount and on `library-changed` (sync pulls, plugin
 *   imports, merges — anything that rewrote rows wholesale);
 * - a single-row refresh on `book-changed` (a cover landed, the engine job
 *   filled metadata), so one tile repaints without re-reading the library;
 * - removal on `book-removed` from any path.
 *
 * Every load also queues engine jobs for books with an open question (no
 * cover verdict, PDF metadata never filled), which is how legacy and
 * interrupted imports catch up without the user opening them.
 */
export function useLibraryStore({ reportError }: LibraryStoreOptions) {
  const books = useAtomValue(libraryBooksAtom);
  const collections = useAtomValue(libraryCollectionsAtom);
  const libraryReady = useAtomValue(libraryReadyAtom);
  const setBooks = useSetAtom(libraryBooksAtom);
  const setCollections = useSetAtom(libraryCollectionsAtom);
  const setLibraryReady = useSetAtom(libraryReadyAtom);

  const loadLibrary = useCallback(async () => {
    try {
      const [loadedBooks, loadedCollections] = await Promise.all([
        listLibraryBooks(),
        listCollections(),
      ]);
      setBooks(loadedBooks);
      setCollections(loadedCollections);
      scheduleCatchUpEnrichment(loadedBooks);
    } catch (error) {
      reportError(error);
    } finally {
      setLibraryReady(true);
    }
  }, [reportError, setBooks, setCollections, setLibraryReady]);

  const refreshBook = useCallback(
    async (bookId: string) => {
      try {
        const book = await getBookRecord(bookId);
        if (!book) return;
        setBooks((current) => upsertBook(current, book));
      } catch (error) {
        reportError(error);
      }
    },
    [reportError, setBooks],
  );

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => onAppEvent("library-changed", () => void loadLibrary()), [loadLibrary]);
  useEffect(
    () => onAppEvent("book-changed", ({ bookId }) => void refreshBook(bookId)),
    [refreshBook],
  );
  useEffect(
    () =>
      onAppEvent("book-removed", ({ bookId }) =>
        setBooks((current) => removeBooks(current, [bookId])),
      ),
    [setBooks],
  );

  const replaceBookInState = useCallback(
    (nextBook: LibraryBook) => setBooks((current) => upsertBook(current, nextBook)),
    [setBooks],
  );

  const applyOptimisticProgress = useCallback(
    (bookId: string, progress: BookProgress) => {
      const timestamp = new Date().toISOString();
      setBooks((current) =>
        patchBook(current, bookId, (book) => createProgressPatch(book, progress, timestamp)),
      );
    },
    [setBooks],
  );

  return {
    books,
    collections,
    libraryReady,
    loadLibrary,
    refreshBook,
    replaceBookInState,
    applyOptimisticProgress,
  };
}
