import { useCallback, useRef } from "react";
import { useToast } from "@read-aware/ui";
import { useTranslation, describeError } from "../../../i18n";
import { catchUpBookGraph } from "../../ai/agent/maintenance";
import type { FoliateBook } from "../../reader/lib/foliate-engine";
import { retainBook } from '../../reader/lib/book-lifetime';
import { enrichFromOpenBook } from "../lib/book-enrichment";
import { ensureBookTextExtracted } from "../lib/book-text-store";
import type { LibraryBook } from "../lib/library-types";
import { createLogger } from "../../../platform/logger";
import { useBookImport } from "./useBookImport";
import { useLibraryCommands } from "./useLibraryCommands";
import { useLibraryStore } from "./useLibraryStore";

export type { ImportOutcome } from "../lib/book-import";

const log = createLogger("library");

/**
 * The shelf's controller: composes the store (load + live updates), the
 * import pipeline, and the user commands behind one facade for the app
 * shell, and owns the one cross-feature hook — what happens when the reader
 * has parsed a book.
 */
export function useLibraryController() {
  const { toast } = useToast();
  const { t } = useTranslation("shelf");
  const tRef = useRef(t);
  tRef.current = t;

  const reportError = useCallback(
    (error: unknown) => {
      // The toast shows a translated summary; keep the underlying cause
      // inspectable in the log file for diagnosis.
      log.error("library operation failed", error);
      toast({
        variant: "destructive",
        title: tRef.current("workspace.errorTitle"),
        description: describeError(error, { fallback: tRef.current("errors.generic") }).body,
      });
    },
    [toast],
  );

  const store = useLibraryStore({ reportError });
  const importer = useBookImport({ reportError });
  const commands = useLibraryCommands({ reportError, reload: store.loadLibrary });

  const bookReadyPendingRef = useRef(new Set<string>());

  /**
   * The reader has parsed the book: reuse that parse for everything that
   * wants one — a still-open cover question (rare: import settles covers
   * natively or through the engine job), full-text extraction for the agent,
   * and the book graph catch-up.
   */
  const handleBookReady = useCallback((book: LibraryBook, foliateBook: FoliateBook) => {
    if (bookReadyPendingRef.current.has(book.id)) return;
    bookReadyPendingRef.current.add(book.id);
    const releaseBook = retainBook(foliateBook);
    void (async () => {
      await enrichFromOpenBook(book, foliateBook);
      // Text extraction always starts on first open, reusing the reader's
      // already-parsed book. It yields between sections and (for long books)
      // checkpoints its progress, so a big scanned PDF neither freezes the UI
      // nor loses its work when the reader closes mid-pass.
      await ensureBookTextExtracted(book.id, foliateBook);
      // 正文就绪后立刻并行追平这本书的图谱欠账（读者在读 = 这本书的图
      // 最值得建）。存量进度从开卷起补，不等空闲节拍或聊天。
      catchUpBookGraph(book.id, book.progress?.href ?? undefined);
    })()
      .catch((error) => log.warn("post-open enrichment failed", error))
      .finally(async () => {
        bookReadyPendingRef.current.delete(book.id);
        await releaseBook().catch(error => log.warn('Could not close parsed book', error));
      });
  }, []);

  return {
    books: store.books,
    collections: store.collections,
    libraryReady: store.libraryReady,
    replaceBookInState: store.replaceBookInState,
    applyOptimisticProgress: store.applyOptimisticProgress,
    pendingBooks: importer.pendingBooks,
    importingCount: importer.importingCount,
    isImporting: importer.isImporting,
    importInputRef: importer.importInputRef,
    importSources: importer.importSources,
    openImportPicker: importer.openImportPicker,
    handleImportSelection: importer.handleImportSelection,
    ...commands,
    handleBookReady,
    reportError,
  };
}
