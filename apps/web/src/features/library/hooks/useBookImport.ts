import { useCallback, useRef, type ChangeEvent } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { TFunction } from "i18next";
import { useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { importBook, type ImportOutcome } from "../lib/book-import";
import { canUseNativeFilePicker, pickBookFilesNative } from "../lib/pick-book-files";
import type { BookImportSource, LibraryBook } from "../lib/library-types";
import {
  importingCountAtom,
  libraryBooksAtom,
  pendingImportsAtom,
  removeBooks,
  upsertBook,
} from "../state/library-store";

export type { ImportOutcome };

type BookImportOptions = {
  reportError: (error: unknown) => void;
};

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

/**
 * The import entry points — picker button, hidden file input, OS drops and
 * "open with" — funnel into `importSources`, which runs each source through
 * the import pipeline and lands the result on the shelf as it completes.
 *
 * The picker opens immediately (no work precedes the dialog); each book then
 * appears the moment its `book.imported` commits. The native staging step is
 * the only wait, and a placeholder holds the book's final slot while it runs.
 */
export function useBookImport({ reportError }: BookImportOptions) {
  const books = useAtomValue(libraryBooksAtom);
  const booksRef = useRef(books);
  booksRef.current = books;
  const setBooks = useSetAtom(libraryBooksAtom);
  const pendingBooks = useAtomValue(pendingImportsAtom);
  const setPendingBooks = useSetAtom(pendingImportsAtom);
  const importingCount = useAtomValue(importingCountAtom);
  const setImportingCount = useSetAtom(importingCountAtom);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  // Keep the latest translator in a ref so the callbacks below stay stable
  // (deps free of `t`) yet always format notices in the active language.
  const { t } = useTranslation("shelf");
  const tRef = useRef(t);
  tRef.current = t;

  const importSources = useCallback(
    async (sources: BookImportSource[]): Promise<ImportOutcome[]> => {
      if (sources.length === 0) return [];
      setImportingCount((current) => current + sources.length);

      let imported = 0;
      const duplicates: string[] = [];
      const outcomes: ImportOutcome[] = [];
      // Books landed by this batch count as known for the next source, so a
      // batch containing the same file twice dedupes against itself.
      const knownBooks: LibraryBook[] = [...booksRef.current];
      for (const source of sources) {
        let placeholderId: string | null = null;
        try {
          const outcome = await importBook(source, {
            t: tRef.current,
            knownBooks,
            onPrepared: (placeholder) => {
              placeholderId = placeholder.id;
              setPendingBooks((current) => upsertBook(current, placeholder));
            },
          });
          outcomes.push(outcome);
          if (outcome.status === "duplicate") {
            duplicates.push(outcome.book.title);
          } else {
            imported += 1;
            knownBooks.unshift(outcome.book);
            // Same id and sort fields as the placeholder: the slot does not move.
            setBooks((current) => upsertBook(current, outcome.book));
          }
        } catch (error) {
          reportError(error);
        } finally {
          if (placeholderId) {
            const id = placeholderId;
            setPendingBooks((current) => removeBooks(current, [id]));
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
      return outcomes;
    },
    [reportError, setBooks, setImportingCount, setPendingBooks, toast],
  );

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

  const handleImportSelection = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const sources: BookImportSource[] = Array.from(input.files ?? []).map((file) => ({
        kind: "file",
        file,
      }));
      input.value = "";
      await importSources(sources);
    },
    [importSources],
  );

  return {
    pendingBooks,
    importingCount,
    isImporting: importingCount > 0,
    importInputRef,
    importSources,
    openImportPicker,
    handleImportSelection,
  };
}
