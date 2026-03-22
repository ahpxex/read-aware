import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalAtom } from "../../../state/local";
import { getStoredBookBlob, markLibraryBookOpened, updateLibraryBookProgress } from "../../library/lib/library-db";
import { formatLibraryError } from "../../library/lib/format-library-error";
import { createProgressPatch } from "../../library/lib/library-progress";
import type {
  BookProgress,
  EpubProgress,
  LibraryBook,
  PdfProgress,
} from "../../library/lib/library-types";
import type { LoadedEpub, TocEntry } from "../lib/epub-types";
import type { LoadedPdf } from "../lib/pdf-types";

type ReaderSource =
  | { format: "epub"; data: LoadedEpub }
  | { format: "pdf"; data: LoadedPdf }
  | null;

type UseReaderSessionOptions = {
  applyOptimisticProgress: (bookId: string, progress: BookProgress) => void;
  replaceBookInState: (book: LibraryBook) => void;
  reportError: (error: unknown) => void;
};

export function useReaderSession({
  applyOptimisticProgress,
  replaceBookInState,
  reportError,
}: UseReaderSessionOptions) {
  const [selectedBook, setSelectedBook] = useState<LibraryBook | null>(null);
  const [readerSource, setReaderSource] = useState<ReaderSource>(null);
  const [readerLoadError, setReaderLoadError] = useState<string | null>(null);
  const [isReaderLoading, setIsReaderLoading] = useState(false);
  const [shellVisible, setShellVisible] = useLocalAtom(false);
  const [readerPage, setReaderPage] = useLocalAtom({ current: 0, total: 0 });
  const [readerToc, setReaderToc] = useLocalAtom<TocEntry[]>([]);
  const [currentChapterHref, setCurrentChapterHref] = useLocalAtom<string | null>(null);
  const [chapterNavigationRequest, setChapterNavigationRequest] = useLocalAtom<{
    href: string;
    requestId: number;
  } | null>(null);
  const readerLoadRequestIdRef = useRef(0);
  const pendingProgressSaveRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    return () => {
      pendingProgressSaveRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      pendingProgressSaveRef.current.clear();
    };
  }, []);

  const resetReaderState = useCallback(() => {
    setReaderSource(null);
    setReaderLoadError(null);
    setIsReaderLoading(false);
    setReaderPage({ current: 0, total: 0 });
    setReaderToc([]);
    setCurrentChapterHref(null);
    setChapterNavigationRequest(null);
  }, [
    setChapterNavigationRequest,
    setCurrentChapterHref,
    setReaderPage,
    setReaderToc,
  ]);

  const queueProgressSave = useCallback((bookId: string, progress: BookProgress) => {
    const existingTimeout = pendingProgressSaveRef.current.get(bookId);
    if (existingTimeout != null) {
      window.clearTimeout(existingTimeout);
    }

    const timeoutId = window.setTimeout(() => {
      pendingProgressSaveRef.current.delete(bookId);
      void updateLibraryBookProgress(bookId, progress)
        .then((nextBook) => {
          if (!nextBook) return;

          setSelectedBook((currentBook) => (
            currentBook?.id === nextBook.id ? nextBook : currentBook
          ));
          replaceBookInState(nextBook);
        })
        .catch((error) => {
          reportError(error);
        });
    }, 250);

    pendingProgressSaveRef.current.set(bookId, timeoutId);
  }, [replaceBookInState, reportError]);

  const applyReaderProgress = useCallback((bookId: string, progress: BookProgress) => {
    applyOptimisticProgress(bookId, progress);
    setSelectedBook((currentBook) => (
      currentBook?.id === bookId
        ? createProgressPatch(currentBook, progress)
        : currentBook
    ));
    queueProgressSave(bookId, progress);
  }, [applyOptimisticProgress, queueProgressSave]);

  const openReader = useCallback((book: LibraryBook) => {
    const requestId = readerLoadRequestIdRef.current + 1;
    readerLoadRequestIdRef.current = requestId;

    setSelectedBook(book);
    setShellVisible(book.format === "pdf");
    resetReaderState();
    setIsReaderLoading(true);

    void (async () => {
      try {
        const blob = await getStoredBookBlob(book.id);
        if (!blob) {
          throw new Error("The imported file for this book could not be found on this device.");
        }

        const data = await blob.arrayBuffer();
        if (readerLoadRequestIdRef.current !== requestId) return;

        setReaderSource(book.format === "epub"
          ? {
              format: "epub",
              data: {
                fileName: book.fileName,
                data,
              },
            }
          : {
              format: "pdf",
              data: {
                fileName: book.fileName,
                data,
              },
            });
        setIsReaderLoading(false);

        void markLibraryBookOpened(book.id)
          .then((nextBook) => {
            if (!nextBook) return;

            setSelectedBook((currentBook) => (
              currentBook?.id === nextBook.id ? nextBook : currentBook
            ));
            replaceBookInState(nextBook);
          })
          .catch((error) => {
            reportError(error);
          });
      } catch (error) {
        if (readerLoadRequestIdRef.current !== requestId) return;
        setReaderLoadError(formatLibraryError(error));
        setIsReaderLoading(false);
      }
    })();
  }, [replaceBookInState, reportError, resetReaderState, setShellVisible]);

  const closeReader = useCallback(() => {
    readerLoadRequestIdRef.current += 1;
    setSelectedBook(null);
    setShellVisible(false);
    resetReaderState();
  }, [resetReaderState, setShellVisible]);

  const toggleShell = useCallback(() => {
    setShellVisible((visible) => !visible);
  }, [setShellVisible]);

  const hideShell = useCallback(() => {
    setShellVisible(false);
  }, [setShellVisible]);

  const handleReaderPageChange = useCallback((current: number, total: number) => {
    setReaderPage({ current, total });
  }, [setReaderPage]);

  const handleEpubProgressChange = useCallback((progress: EpubProgress) => {
    setReaderPage({
      current: progress.currentLocation,
      total: progress.totalLocations,
    });

    if (!selectedBook) return;
    applyReaderProgress(selectedBook.id, progress);
  }, [applyReaderProgress, selectedBook, setReaderPage]);

  const handlePdfProgressChange = useCallback((progress: PdfProgress) => {
    setReaderPage({
      current: progress.currentPage,
      total: progress.totalPages,
    });

    if (!selectedBook) return;
    applyReaderProgress(selectedBook.id, progress);
  }, [applyReaderProgress, selectedBook, setReaderPage]);

  const handleChapterSelect = useCallback((href: string) => {
    setChapterNavigationRequest((previous) => ({
      href,
      requestId: (previous?.requestId ?? 0) + 1,
    }));
    setShellVisible(false);
  }, [setChapterNavigationRequest, setShellVisible]);

  const overlayVisible = selectedBook?.format === "pdf" ? true : shellVisible;
  const selectedEpubProgress = selectedBook?.progress?.format === "epub"
    ? selectedBook.progress
    : null;
  const selectedPdfProgress = selectedBook?.progress?.format === "pdf"
    ? selectedBook.progress
    : null;
  const readerProgress = readerPage.total > 0
    ? readerPage.current / readerPage.total
    : selectedBook?.progressPercent
      ? selectedBook.progressPercent / 100
      : undefined;
  const currentPosition = readerPage.total > 0
    ? `Page ${readerPage.current} of ${readerPage.total}`
    : undefined;

  return {
    selectedBook,
    readerSource,
    readerLoadError,
    isReaderLoading,
    readerToc,
    currentChapterHref,
    chapterNavigationRequest,
    overlayVisible,
    selectedEpubProgress,
    selectedPdfProgress,
    readerProgress,
    currentPosition,
    openReader,
    closeReader,
    toggleShell,
    hideShell,
    handleReaderPageChange,
    handleEpubProgressChange,
    handlePdfProgressChange,
    handleChapterSelect,
    setReaderToc,
    setCurrentChapterHref,
  };
}
