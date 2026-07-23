import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import type { TFunction } from "i18next";
import { useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { formatLibraryError } from "../lib/format-library-error";
import { deleteBookText, ensureBookTextExtracted } from "../lib/book-text-store";
import {
  commitBookImport,
  enrichOpenedBook,
  listCollections,
  listLibraryBooks,
  prepareBookImport,
} from "../lib/library-db";
import { userDomain } from "../../../domain";
import { createProgressPatch } from "../lib/library-progress";
import { canUseNativeFilePicker, pickBookFilesNative } from "../lib/pick-book-files";
import type {
  BookMetadataPatch,
  BookImportSource,
  BookProgress,
  Collection,
  LibraryBook,
} from "../lib/library-types";
import type { FoliateBook } from "../../reader/lib/foliate-engine";
import { onAppEvent } from "../../../platform/app-events";

function formatImportNotice(
  imported: number,
  duplicates: string[],
  t: TFunction<"shelf">,
): string {
  const skipped = t("importNotice.duplicate", {
    count: duplicates.length,
    title: duplicates[0],
  });
  return imported > 0 ? t("importNotice.combined", { skipped, count: imported }) : skipped;
}

export function useLibraryController() {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const booksRef = useRef(books);
  booksRef.current = books;
  // Prepared imports carry their final id and metadata while their source file
  // is still being copied. Rendering them through the normal shelf sorter keeps
  // the reserved slot identical to the committed book's final slot.
  const [pendingBooks, setPendingBooks] = useState<LibraryBook[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  // Files still in the import pipeline drive the header's disabled state and
  // keep an empty library out of its empty state. Prepared records below drive
  // any delayed shelf feedback at their real sorted positions.
  const [importingCount, setImportingCount] = useState(0);
  const isImporting = importingCount > 0;
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  // Keep the latest translator in a ref so the callbacks below stay stable
  // (deps free of `t`) yet always format errors/notices in the active language.
  const { t } = useTranslation("shelf");
  const tRef = useRef(t);
  tRef.current = t;

  const reportError = useCallback(
    (error: unknown) => {
      // The toast shows a translated summary; keep the underlying cause
      // inspectable in the console/logcat for diagnosis.
      console.error("[library]", error);
      toast({
        variant: "destructive",
        title: tRef.current("workspace.errorTitle"),
        description: formatLibraryError(error, tRef.current),
      });
    },
    [toast],
  );

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
      const [loadedBooks, loadedCollections] = await Promise.all([
        listLibraryBooks(),
        listCollections(),
      ]);
      setBooks(loadedBooks);
      setCollections(loadedCollections);
    } catch (error) {
      reportError(error);
    } finally {
      setLibraryReady(true);
    }
  }, [reportError]);

  // Plugin imports (and any out-of-band writer) announce via the event bus.
  useEffect(() => onAppEvent("library-changed", () => void loadLibrary()), [loadLibrary]);

  const sortCollections = (list: Collection[]) =>
    [...list].sort((a, b) => a.name.localeCompare(b.name));

  const handleCreateCollection = useCallback(
    async (name: string): Promise<Collection | null> => {
      try {
        const collection = await userDomain.collections.create(name);
        setCollections((current) => sortCollections([...current, collection]));
        return collection;
      } catch (error) {
        reportError(error);
        return null;
      }
    },
    [reportError],
  );

  const handleRenameCollection = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCollections((current) =>
      sortCollections(current.map((c) => (c.id === id ? { ...c, name: trimmed } : c))),
    );
    void userDomain.collections.rename(id, trimmed).catch((error) => {
      void loadLibrary();
      reportError(error);
    });
  }, [loadLibrary, reportError]);

  const handleDeleteCollection = useCallback((id: string) => {
    setCollections((current) => current.filter((c) => c.id !== id));
    setBooks((current) =>
      current.map((book) => (book.collectionId === id ? { ...book, collectionId: null } : book)),
    );
    void userDomain.collections.remove(id).catch((error) => {
      void loadLibrary();
      reportError(error);
    });
  }, [loadLibrary, reportError]);

  const handleSetBooksCollection = useCallback(
    (ids: string[], collectionId: string | null) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      setBooks((current) =>
        current.map((book) => (idSet.has(book.id) ? { ...book, collectionId } : book)),
      );
      void userDomain.collections.assignBooks(ids, collectionId).catch((error) => {
        void loadLibrary();
        reportError(error);
      });
    },
    [loadLibrary, reportError],
  );

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const bookReadyPendingRef = useRef(new Set<string>());

  /**
   * Metadata, cover, and text enrichment now reuse the reader's parsed book.
   * Import never runs foliate on the UI thread just because a file was picked.
   */
  const handleBookReady = useCallback((book: LibraryBook, foliateBook: FoliateBook) => {
    if (bookReadyPendingRef.current.has(book.id)) return;
    bookReadyPendingRef.current.add(book.id);
    void (async () => {
      if (!book.coverChecked) {
        const result = await enrichOpenedBook(book, foliateBook);
        if (result.status === "removed") return;
        if (result.status === "duplicate") {
          setBooks((current) => current.filter((entry) => entry.id !== book.id));
          toast({
            title: tRef.current("workspace.importTitle"),
            description: formatImportNotice(0, [result.book.title], tRef.current),
          });
          return;
        }
        setBooks((current) =>
          current.map((entry) => (entry.id === book.id ? result.book : entry)),
        );
      }
      // Full PDF text extraction is deliberately lazy for very large/scanned
      // documents. Starting hundreds of page decodes immediately after the
      // first paint would make "open book" feel busy again; the agent's text
      // port will trigger the same extraction only when whole-book context is
      // actually requested.
      const pageCount = foliateBook.sections?.length ?? 0;
      const eagerPdfText = book.fileSize <= 64 * 1024 * 1024 && pageCount <= 300;
      if (book.format !== "pdf" || eagerPdfText) {
        await ensureBookTextExtracted(book.id, foliateBook);
      }
    })()
      .catch((error) => console.warn("[library] lazy enrich failed", error))
      .finally(() => bookReadyPendingRef.current.delete(book.id));
  }, [toast]);

  const importSources = useCallback(async (sources: BookImportSource[]) => {
    if (sources.length === 0) return;

    setImportingCount(sources.length);

    let imported = 0;
    const duplicates: string[] = [];
    const knownBooks = [...booksRef.current];
    try {
      for (const source of sources) {
        let pendingBookId: string | null = null;
        try {
          const result = await prepareBookImport(source, tRef.current, knownBooks);
          if (result.status === "duplicate") duplicates.push(result.book.title);
          else {
            pendingBookId = result.book.id;
            setPendingBooks((current) => [...current, result.book]);
            await commitBookImport(result.book, source);
            imported += 1;
            // Swap the pending entry for the durable book in one React batch.
            // The id and all sort fields stay identical, so its grid slot does not move.
            setBooks((current) => [result.book, ...current]);
            knownBooks.unshift(result.book);
          }
        } finally {
          if (pendingBookId) {
            setPendingBooks((current) => current.filter((book) => book.id !== pendingBookId));
          }
          setImportingCount((current) => Math.max(0, current - 1));
        }
      }

      if (duplicates.length > 0) {
        toast({
          title: tRef.current("workspace.importTitle"),
          description: formatImportNotice(imported, duplicates, tRef.current),
        });
      }
    } catch (error) {
      reportError(error);
    } finally {
      setImportingCount(0);
    }
  }, [reportError, toast]);

  // One native picker at a time: a re-trigger while a dialog is pending would
  // start a second concurrent import flow, and the import dedupe reads
  // the library before either flow has written — the same book lands twice.
  // (Safe to guard on the promise: Android routes around the dialog plugin's
  // lossy response channel via park-and-poll in pick-book-files.ts, so the
  // pick always settles — including on cancel.)
  const pickerPendingRef = useRef(false);

  const openImportPicker = useCallback(() => {
    // Desktop: the webview ignores the <input accept> filter, so drive the
    // native OS dialog (with a real Books format filter) instead. Web/dev falls
    // back to the hidden file input.
    if (canUseNativeFilePicker()) {
      if (pickerPendingRef.current) return;
      pickerPendingRef.current = true;
      void pickBookFilesNative(tRef.current)
        .then(importSources)
        .catch(reportError)
        .finally(() => {
          pickerPendingRef.current = false;
        });
      return;
    }

    importInputRef.current?.click();
  }, [importSources, reportError]);

  const handleImportSelection = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const sources: BookImportSource[] = Array.from(input.files ?? [])
      .map((file) => ({ kind: "file", file }));
    input.value = "";
    await importSources(sources);
  }, [importSources]);

  const handleToggleStar = useCallback((book: LibraryBook) => {
    const nextStarred = !book.starred;
    // Optimistic: flip in state immediately so the shelf re-pins without waiting
    // on IndexedDB; roll back if the write fails.
    setBooks((currentBooks) =>
      currentBooks.map((entry) => (entry.id === book.id ? { ...entry, starred: nextStarred } : entry)),
    );
    void userDomain.books.setStarred(book.id, nextStarred).catch((error) => {
      setBooks((currentBooks) =>
        currentBooks.map((entry) => (entry.id === book.id ? { ...entry, starred: book.starred } : entry)),
      );
      reportError(error);
    });
  }, [reportError]);

  const handleUpdateBookMetadata = useCallback(
    (book: LibraryBook, patch: BookMetadataPatch) => {
      const title = patch.title?.trim() || book.title;
      const author = patch.author?.trim() || book.author;
      if (title === book.title && author === book.author) return;

      // Optimistic: reflect the edit immediately; roll back if the write fails.
      setBooks((currentBooks) =>
        currentBooks.map((entry) =>
          entry.id === book.id ? { ...entry, title, author } : entry,
        ),
      );
      void userDomain.books.editMetadata(book.id, { title, author }).catch((error) => {
        setBooks((currentBooks) =>
          currentBooks.map((entry) =>
            entry.id === book.id
              ? { ...entry, title: book.title, author: book.author }
              : entry,
          ),
        );
        reportError(error);
      });
    },
    [reportError],
  );

  const handleRemoveBook = useCallback((book: LibraryBook) => {
    void userDomain.books.remove(book.id)
      .then(() => {
        setBooks((currentBooks) => currentBooks.filter((entry) => entry.id !== book.id));
        void deleteBookText([book.id]).catch(() => {});
      })
      .catch((error) => {
        reportError(error);
      });
  }, [reportError]);

  const handleRemoveMany = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    void userDomain.books.removeMany(ids)
      .then(() => {
        setBooks((currentBooks) => currentBooks.filter((entry) => !idSet.has(entry.id)));
        void deleteBookText(ids).catch(() => {});
      })
      .catch((error) => {
        reportError(error);
      });
  }, [reportError]);

  return {
    books,
    pendingBooks,
    collections,
    libraryReady,
    isImporting,
    importingCount,
    importInputRef,
    openImportPicker,
    handleImportSelection,
    handleRemoveBook,
    handleToggleStar,
    handleUpdateBookMetadata,
    handleRemoveMany,
    handleCreateCollection,
    handleRenameCollection,
    handleDeleteCollection,
    handleSetBooksCollection,
    replaceBookInState,
    applyOptimisticProgress,
    handleBookReady,
    reportError,
  };
}
