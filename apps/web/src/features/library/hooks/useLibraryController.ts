import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import type { TFunction } from "i18next";
import { useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { formatLibraryError } from "../lib/format-library-error";
import { deleteBookText, ensureBookTextExtracted } from "../lib/book-text-store";
import {
  createCollection,
  deleteCollection,
  enrichImportedBook,
  importBookFile,
  listCollections,
  listLibraryBooks,
  removeLibraryBook,
  removeLibraryBooks,
  renameCollection,
  setBooksCollection,
  setLibraryBookStarred,
  updateBookMetadata,
} from "../lib/library-db";
import { createProgressPatch } from "../lib/library-progress";
import { canUseNativeFilePicker, pickBookFilesNative } from "../lib/pick-book-files";
import type {
  BookMetadataPatch,
  BookProgress,
  Collection,
  LibraryBook,
} from "../lib/library-types";

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
  const [collections, setCollections] = useState<Collection[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  // Files still in the import fast path — drives the header's disabled state
  // and one shelf skeleton card per pending file.
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

  const sortCollections = (list: Collection[]) =>
    [...list].sort((a, b) => a.name.localeCompare(b.name));

  const handleCreateCollection = useCallback(
    async (name: string): Promise<Collection | null> => {
      try {
        const collection = await createCollection(name);
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
    void renameCollection(id, trimmed).catch((error) => {
      void loadLibrary();
      reportError(error);
    });
  }, [loadLibrary, reportError]);

  const handleDeleteCollection = useCallback((id: string) => {
    setCollections((current) => current.filter((c) => c.id !== id));
    setBooks((current) =>
      current.map((book) => (book.collectionId === id ? { ...book, collectionId: null } : book)),
    );
    void deleteCollection(id).catch((error) => {
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
      void setBooksCollection(ids, collectionId).catch((error) => {
        void loadLibrary();
        reportError(error);
      });
    },
    [loadLibrary, reportError],
  );

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  /**
   * 后台富化（一次 foliate 解析 → 真实元数据/封面 → 正文抽取）逐本排队：
   * 解析是主线程上的秒级 CPU 块,串行让 UI 的卡顿窗口一次只有一本书,
   * 也避免和后续导入抢主线程。跨批次共享同一条链。
   */
  const enrichChainRef = useRef<Promise<void>>(Promise.resolve());

  const enqueueEnrichment = useCallback((book: LibraryBook, file: File) => {
    enrichChainRef.current = enrichChainRef.current.then(async () => {
      try {
        const result = await enrichImportedBook(book, file);
        if (result.status === "removed") return;
        if (result.status === "duplicate") {
          // 换名重导：真实元数据到手才认得出来 —— 记录已回滚,书架同步撤下
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
        // 正文抽取管道（§11.5）：导入即抽取并持久化，agent 首次对话不用等
        // 整书解析。复用富化那次 parse；失败静默 —— 端口会在需要时懒回填。
        await ensureBookTextExtracted(book.id, result.foliateBook ?? undefined).catch(() => {});
      } catch (error) {
        // 富化失败不撤书：文件名标题照用,封面由 listLibraryBooks 的懒回填兜底
        console.warn("[library] enrich failed", error);
      }
    });
  }, [toast]);

  const importFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    setImportingCount(files.length);

    let imported = 0;
    const duplicates: string[] = [];
    try {
      for (const file of files) {
        try {
          const result = await importBookFile(file, tRef.current);
          if (result.status === "duplicate") duplicates.push(result.book.title);
          else {
            imported += 1;
            // 立即上架（占位封面 + 文件名标题）,重活全部进后台队列
            setBooks((current) => [result.book, ...current]);
            enqueueEnrichment(result.book, file);
          }
        } finally {
          // 每本落地就撤掉对应的骨架卡，而不是等整批
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
  }, [enqueueEnrichment, reportError, toast]);

  // One native picker at a time: a re-trigger while a dialog is pending would
  // start a second concurrent importFiles flow, and the import dedupe reads
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
        .then(importFiles)
        .catch(reportError)
        .finally(() => {
          pickerPendingRef.current = false;
        });
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
      void updateBookMetadata(book.id, { title, author }).catch((error) => {
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
    void removeLibraryBook(book.id)
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
    void removeLibraryBooks(ids)
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
    reportError,
  };
}
