import { useCallback, useEffect, useRef, useState } from "react";
import { describeError, useTranslation } from "../../../i18n";
import { useLocalAtom } from "@read-aware/ui/state";
import {
  markLibraryBookOpened,
  resolveStoredBookFile,
  type BookFileMissingReason,
} from "../../library/lib/library-db";
import { noteReadingPosition } from "../../../platform/reading-session";
import { createLogger } from "../../../platform/logger";
import { createProgressPatch, getReadingStatus } from "../../library/lib/library-progress";
import type {
  BookFormat,
  BookProgress,
  LibraryBook,
  ReaderProgress,
} from "../../library/lib/library-types";
import type { LoadedBook, TocEntry } from "../lib/reader-types";
import { getVirtualBookBinding } from "../../plugins/lib/virtual-books";
import { AppError } from "@read-aware/core";
import { readingRuntime } from "../../../domain/reading-runtime";
import { useReaderControls } from "./useReaderControls";

type ReaderSource =
  | { format: BookFormat; data: LoadedBook }
  | null;

/**
 * Why the reader couldn't open. `file-missing` keeps the CAUSE, because the
 * error screen owes each one different words and a different action — "retry"
 * heals an unreachable relay but never a file the cloud simply doesn't have,
 * where re-importing the original file is the honest way out (a re-import of
 * the same bytes heals the existing record in place via the sha dedup gate).
 */
export type ReaderLoadError =
  | { kind: "generic"; message: string }
  | { kind: "file-missing"; reason: BookFileMissingReason };

type UseReaderSessionOptions = {
  applyOptimisticProgress: (bookId: string, progress: BookProgress) => void;
  replaceBookInState: (book: LibraryBook) => void;
  reportError: (error: unknown) => void;
};

const log = createLogger("reader");

export function useReaderSession({
  applyOptimisticProgress,
  replaceBookInState,
  reportError,
}: UseReaderSessionOptions) {
  // For localizing load-failure fallbacks (describeError's shelf fallback).
  const { t } = useTranslation(["shelf", "common"]);
  const [selectedBook, setSelectedBook] = useState<LibraryBook | null>(null);
  const [readerSource, setReaderSource] = useState<ReaderSource>(null);
  const [readerLoadError, setReaderLoadError] = useState<ReaderLoadError | null>(null);
  const [isReaderLoading, setIsReaderLoading] = useState(false);
  const { controls, visible: shellVisible, setVisible: setShellVisible } = useReaderControls();
  const controlsBinding = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => controlsBinding.current?.(), []);
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

  // A position is STATE, not an event: it goes to the reading session's
  // scratch bucket (overwritten by every turn) and reaches the log once, as
  // part of the `book.sessionRecorded` event minted when the session closes
  // — see useReadingTimeTracker / reading-session-policy.ts. The optimistic
  // patch keeps the shelf and header current meanwhile.
  const noteProgress = useCallback((bookId: string, progress: BookProgress) => {
    if (!progress) return;
    const progressPercent = Math.max(0, Math.min(100, Math.round(progress.progressPercent)));
    void noteReadingPosition(
      bookId,
      {
        locator: progress.cfi ?? progress.href ?? "",
        chapterHref: progress.href ?? undefined,
        currentLocation: progress.currentLocation,
        totalLocations: progress.totalLocations,
        progressPercent,
        status: getReadingStatus(progressPercent),
      },
      Date.now(),
    ).catch((error: unknown) => {
      // The next turn (or the tick) carries the position; nothing to show.
      log.warn("could not note the reading position", error);
    });
  }, []);

  const applyReaderProgress = useCallback((bookId: string, progress: BookProgress) => {
    applyOptimisticProgress(bookId, progress);
    setSelectedBook((currentBook) => (
      currentBook?.id === bookId
        ? createProgressPatch(currentBook, progress)
        : currentBook
    ));
    noteProgress(bookId, progress);
  }, [applyOptimisticProgress, noteProgress]);

  const openReader = useCallback((book: LibraryBook, navigationIntent?: number) => {
    const sessionId = readingRuntime.begin(book.id, navigationIntent);
    controlsBinding.current?.();
    controlsBinding.current = readingRuntime.bindControls(sessionId, controls);
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
        const resolved = await resolveStoredBookFile(book);
        if (readerLoadRequestIdRef.current !== requestId) return;
        if (resolved.status === "missing") {
          readingRuntime.fail(sessionId, new AppError("fs/not-found", `Book source missing: ${resolved.reason}`));
          setReaderLoadError({ kind: "file-missing", reason: resolved.reason });
          setIsReaderLoading(false);
          return;
        }

        setReaderSource({
          format: book.format,
          data: {
            fileName: book.fileName,
            format: book.format,
            file: resolved.file,
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
        log.error("opening book failed", error);
        readingRuntime.fail(sessionId, error);
        setReaderLoadError({
          kind: "generic",
          message: describeError(error, { fallback: t("shelf:errors.generic") }).body,
        });
        setIsReaderLoading(false);
      }
    })();
  }, [controls, replaceBookInState, reportError, resetReaderState, setShellVisible, t]);

  const closeReader = useCallback(() => {
    readingRuntime.closed();
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
