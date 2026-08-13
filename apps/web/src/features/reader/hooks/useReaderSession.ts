import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { useTranslation } from "../../../i18n";
import { useLocalAtom } from "@read-aware/ui/state";
import { askAiRequestAtom } from "../../ai/state/chat-intent";
import { readerPanelIntentAtom } from "../state/panel-intent";
import { getStoredBookFile, markLibraryBookOpened, updateLibraryBookProgress } from "../../library/lib/library-db";
import { formatLibraryError } from "../../library/lib/format-library-error";
import { createProgressPatch } from "../../library/lib/library-progress";
import type {
  BookFormat,
  BookProgress,
  LibraryBook,
  ReaderProgress,
} from "../../library/lib/library-types";
import type { LoadedBook, TocEntry } from "../lib/reader-types";
import { createProgressThrottle } from "../lib/progress-throttle";
import { getVirtualBookBinding } from "../../plugins/lib/virtual-books";

type ReaderSource =
  | { format: BookFormat; data: LoadedBook }
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
  // For localizing load-failure fallbacks (formatLibraryError's generic line).
  const { t } = useTranslation("shelf");
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
  const [annotationNavigationRequest, setAnnotationNavigationRequest] = useLocalAtom<{
    cfiRange: string;
    requestId: number;
  } | null>(null);
  const [fractionNavigationRequest, setFractionNavigationRequest] = useLocalAtom<{
    fraction: number;
    requestId: number;
  } | null>(null);
  // The engine's exact reading fraction. The persisted progress only carries a
  // rounded percentage, which is too coarse to paint (or seek from) the
  // header's progress bar.
  const [readerFraction, setReaderFraction] = useLocalAtom<number | null>(null);
  const readerLoadRequestIdRef = useRef(0);
  // Commit-side throttle for book.progressed: chapter changes commit promptly,
  // intra-chapter page turns coalesce (see progress-throttle.ts). Created once;
  // the commit callback reads the latest handlers through a ref so the
  // throttle's per-book pacing state survives re-renders.
  const latestProgressHandlersRef = useRef({ replaceBookInState, reportError });
  const progressThrottleRef = useRef(
    createProgressThrottle((bookId, progress) => {
      const { replaceBookInState: replaceBook, reportError: report } =
        latestProgressHandlersRef.current;
      void updateLibraryBookProgress(bookId, progress)
        .then((nextBook) => {
          if (!nextBook) return;
          setSelectedBook((currentBook) =>
            currentBook?.id === nextBook.id ? nextBook : currentBook,
          );
          replaceBook(nextBook);
        })
        .catch((error) => {
          report(error);
        });
    }),
  );

  // "Ask AI about this" should reveal the reader shell even when the chrome is
  // dismissed (immersive reading), so the chat panel it opens is actually shown.
  const askAiRequest = useAtomValue(askAiRequestAtom);
  const handledAskAiIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!askAiRequest || askAiRequest.bookId !== selectedBook?.id) return;
    if (askAiRequest.id === handledAskAiIdRef.current) return;
    handledAskAiIdRef.current = askAiRequest.id;
    setShellVisible(true);
  }, [askAiRequest, selectedBook?.id, setShellVisible]);

  // 导航条的面板直达按钮同理：面板渲染在 chrome 里，意图到达即点亮 chrome
  // （目标面板由 ReaderShellOverlay 消费同一意图打开）。
  const panelIntent = useAtomValue(readerPanelIntentAtom);
  const handledPanelIntentIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!panelIntent || panelIntent.bookId !== selectedBook?.id) return;
    if (panelIntent.id === handledPanelIntentIdRef.current) return;
    handledPanelIntentIdRef.current = panelIntent.id;
    setShellVisible(true);
  }, [panelIntent, selectedBook?.id, setShellVisible]);

  useEffect(() => {
    const throttle = progressThrottleRef.current;
    return () => {
      // Flush, don't drop: a pending position on unmount is the user's last
      // reading position — losing it means reopening the book somewhere else.
      throttle.dispose();
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
    setAnnotationNavigationRequest(null);
    setFractionNavigationRequest(null);
    setReaderFraction(null);
  }, [
    setAnnotationNavigationRequest,
    setChapterNavigationRequest,
    setCurrentChapterHref,
    setFractionNavigationRequest,
    setReaderFraction,
    setReaderPage,
    setReaderToc,
  ]);

  const queueProgressSave = useCallback((bookId: string, progress: BookProgress) => {
    latestProgressHandlersRef.current = { replaceBookInState, reportError };
    progressThrottleRef.current.queue(bookId, progress);
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
    setShellVisible(false);
    resetReaderState();
    setIsReaderLoading(true);

    void (async () => {
      try {
        if (book.format === "virtual") {
          const binding = getVirtualBookBinding(book.id);
          if (!binding) {
            throw new Error("This book's plugin content source is not available.");
          }
          if (readerLoadRequestIdRef.current !== requestId) return;
          setReaderSource({
            format: book.format,
            data: { fileName: book.title, format: book.format, virtual: binding },
          });
          setIsReaderLoading(false);
        } else {
        const file = await getStoredBookFile(book);
        if (!file) {
          throw new Error("The imported file for this book could not be found on this device.");
        }
        if (readerLoadRequestIdRef.current !== requestId) return;

        setReaderSource({
          format: book.format,
          data: {
            fileName: book.fileName,
            format: book.format,
            file,
          },
        });
        setIsReaderLoading(false);
        }

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
        setReaderLoadError(formatLibraryError(error, t));
        setIsReaderLoading(false);
      }
    })();
  }, [replaceBookInState, reportError, resetReaderState, setShellVisible, t]);

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

  const handleEpubProgressChange = useCallback((progress: ReaderProgress) => {
    setReaderPage({
      current: progress.currentLocation,
      total: progress.totalLocations,
    });

    if (!selectedBook) return;
    applyReaderProgress(selectedBook.id, progress);
  }, [applyReaderProgress, selectedBook, setReaderPage]);

  const handleReaderFractionChange = useCallback((fraction: number) => {
    setReaderFraction(fraction);
  }, [setReaderFraction]);

  // Scrubbing the header's progress bar. The shell deliberately stays open —
  // the user is working the header, and may well scrub again.
  const handleSeek = useCallback((fraction: number) => {
    setFractionNavigationRequest((previous) => ({
      fraction,
      requestId: (previous?.requestId ?? 0) + 1,
    }));
  }, [setFractionNavigationRequest]);

  const handleChapterSelect = useCallback((href: string) => {
    setChapterNavigationRequest((previous) => ({
      href,
      requestId: (previous?.requestId ?? 0) + 1,
    }));
    setShellVisible(false);
  }, [setChapterNavigationRequest, setShellVisible]);

  const handleAnnotationSelect = useCallback((cfiRange: string) => {
    setAnnotationNavigationRequest((previous) => ({
      cfiRange,
      requestId: (previous?.requestId ?? 0) + 1,
    }));
    setShellVisible(false);
  }, [setAnnotationNavigationRequest, setShellVisible]);

  const overlayVisible = shellVisible;
  const selectedEpubProgress = selectedBook?.progress ?? null;
  // The engine's fraction once it has relocated; before that, the position the
  // book was left at (so the bar opens where reading stopped).
  const readerProgress = readerFraction
    ?? (selectedBook?.progressPercent
      ? selectedBook.progressPercent / 100
      : undefined);

  return {
    selectedBook,
    readerSource,
    readerLoadError,
    isReaderLoading,
    readerToc,
    currentChapterHref,
    chapterNavigationRequest,
    annotationNavigationRequest,
    fractionNavigationRequest,
    overlayVisible,
    selectedEpubProgress,
    readerProgress,
    currentPage: readerPage.current,
    totalPages: readerPage.total,
    openReader,
    closeReader,
    toggleShell,
    hideShell,
    handleReaderPageChange,
    handleEpubProgressChange,
    handleReaderFractionChange,
    handleSeek,
    handleChapterSelect,
    handleAnnotationSelect,
    setReaderToc,
    setCurrentChapterHref,
  };
}
