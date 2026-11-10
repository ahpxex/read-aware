import { useCallback, useEffect, useRef, useState } from "react";
import { describeError, useTranslation } from "../../../i18n";
import { useLocalAtom } from "@read-aware/ui/state";
import { acquireBookContent, BookSourceMissingError, type BookContentLease } from "../../library";
import { markLibraryBookOpened, type BookFileMissingReason } from "../../library/lib/library-db";
import { readingTraces } from "../lib/reading-trace-runtime";
import type { ReadingTrace } from "../lib/reading-trace";
import { createLogger } from "../../../platform/logger";
import type { DomainActor } from "../../../platform/domain-actor";
import { createProgressPatch, getReadingStatus } from "../../library/lib/library-progress";
import type { BookFormat, BookProgress, LibraryBook, ReaderProgress } from "../../library/lib/library-types";
import type { LoadedBook, TocEntry } from "../lib/reader-types";
import { getVirtualBookBinding } from "../../plugins/lib/virtual-books";
import { AppError } from "@read-aware/core";
import { readingRuntime } from "../../../domain/reading-runtime";
import { hostSync } from "../../../services/sync";
import { useReaderControls } from "./useReaderControls";

type ReaderSource = { format: BookFormat; data: LoadedBook } | null;

/**
 * Why the reader couldn't open. `file-missing` keeps the CAUSE, because the
 * error screen owes each one different words and a different action — "retry"
 * heals an unreachable relay but never a file the cloud simply doesn't have,
 * where re-importing the original file is the honest way out (a re-import of
 * the same bytes heals the existing record in place via the sha dedup gate).
 */
export type ReaderLoadError =
  | { kind: "generic"; message: string; retryable?: boolean }
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
  const [trace, setTrace] = useState<ReadingTrace | null>(null);
  const traceRef = useRef<ReadingTrace | null>(null);
  const [readerSource, setReaderSource] = useState<ReaderSource>(null);
  const [readerLoadError, setReaderLoadError] = useState<ReaderLoadError | null>(null);
  const [isReaderLoading, setIsReaderLoading] = useState(false);
  // The engine reports parse/render failures to the reading runtime rather
  // than through this hook. The surface handoff needs them too: otherwise it
  // keeps the shelf over a reader that will never paint a page until its
  // fallback timeout, and the error surface appears seconds late.
  const [failedSessionId, setFailedSessionId] = useState<string | null>(null);
  useEffect(
    () =>
      readingRuntime.observe((state) => {
        if (state.status === "error" && state.sessionId) setFailedSessionId(state.sessionId);
      }),
    [],
  );
  const { controls, visible: shellVisible, origin: overlayOrigin, setVisible: setShellVisible } = useReaderControls();
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
  // The lease on the open book's prepared content, held from the moment the
  // book is chosen until another is, or the reader closes.
  const contentLease = useRef<Promise<BookContentLease> | null>(null);
  const releaseContent = useCallback(() => {
    const lease = contentLease.current;
    contentLease.current = null;
    lease
      ?.then(
        (held) => held.release(),
        // A preparation that failed holds nothing to give back.
        () => {},
      )
      .catch((error: unknown) => log.warn("releasing book content failed", error));
  }, []);
  useEffect(() => releaseContent, [releaseContent]);
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
  const noteProgress = useCallback(
    (bookId: string, progress: BookProgress) => {
      if (!progress || !trace?.accepting || trace.bookId !== bookId) return;
      const progressPercent = Math.max(0, Math.min(100, Math.round(progress.progressPercent)));
      trace.position(
        {
          locator: progress.cfi ?? progress.href ?? "",
          chapterHref: progress.href ?? undefined,
          currentLocation: progress.currentLocation,
          totalLocations: progress.totalLocations,
          progressPercent,
          status: getReadingStatus(progressPercent),
          ...(progress.readingMode !== undefined ? { readingMode: progress.readingMode } : {}),
        },
        Date.now(),
      );
    },
    [trace],
  );

  const applyReaderProgress = useCallback(
    (bookId: string, progress: BookProgress) => {
      if (!trace?.accepting || trace.bookId !== bookId) return;
      applyOptimisticProgress(bookId, progress);
      setSelectedBook((currentBook) =>
        currentBook?.id === bookId ? createProgressPatch(currentBook, progress) : currentBook,
      );
      noteProgress(bookId, progress);
    },
    [applyOptimisticProgress, noteProgress, trace],
  );

  const openReader = useCallback(
    (book: LibraryBook, navigationIntent?: number, options?: { resetPosition: true }) => {
      const sessionId = readingRuntime.begin(book.id, navigationIntent, "user");
      const openingActor = readingRuntime.openingActor(sessionId);
      const nextTrace = readingTraces.begin(sessionId, book.id);
      traceRef.current = nextTrace;
      setTrace(nextTrace);
      controlsBinding.current?.();
      controlsBinding.current = readingRuntime.bindControls(sessionId, controls);
      const requestId = readerLoadRequestIdRef.current + 1;
      readerLoadRequestIdRef.current = requestId;

      setSelectedBook(book);
      setShellVisible(false, openingActor);
      resetReaderState();
      setIsReaderLoading(true);

      // The book is found and parsed from this moment, alongside the reader
      // mounting and building its engine; the engine picks the result up.
      const binding = book.format === "virtual" ? getVirtualBookBinding(book.id) : null;
      const lease =
        book.format === "virtual" && !binding
          ? Promise.reject<BookContentLease>(new Error("This book's plugin content source is not available."))
          : acquireBookContent(book.id, { fetchMissing: true });
      // The book before this one is given back only now: releasing it first
      // could push this book out of the kept ones just before it is asked for.
      releaseContent();
      contentLease.current = lease;
      const content = lease.then((held) => held.content);
      // The failure is reported below; a reader that never mounts must not leave this copy of it unobserved.
      content.catch(() => {});
      setReaderSource({
        format: book.format,
        data: {
          fileName: book.format === "virtual" ? book.title : book.fileName,
          format: book.format,
          content,
          ...(binding ? { virtual: binding } : {}),
          resetPosition: options?.resetPosition,
        },
      });

      lease.then(
        () => {
          if (readerLoadRequestIdRef.current !== requestId) return;
          setIsReaderLoading(false);
          void markLibraryBookOpened(book.id, openingActor)
            .then((nextBook) => {
              if (!nextBook) return;

              setSelectedBook((currentBook) => (currentBook?.id === nextBook.id ? nextBook : currentBook));
              replaceBookInState(nextBook);
            })
            .catch((error) => {
              reportError(error);
            });
        },
        (error: unknown) => {
          if (readerLoadRequestIdRef.current !== requestId) return;
          // Nothing to render: the reader gives way to the failure surface.
          setReaderSource(null);
          setIsReaderLoading(false);
          if (error instanceof BookSourceMissingError) {
            readingRuntime.fail(sessionId, error);
            setReaderLoadError({ kind: "file-missing", reason: error.reason });
            return;
          }
          log.error("opening book failed", error);
          readingRuntime.fail(sessionId, error);
          const failure = describeError(error, { fallback: t("shelf:errors.generic") });
          setReaderLoadError({
            kind: "generic",
            message: failure.body,
            retryable: failure.retryable,
          });
        },
      );
    },
    [controls, releaseContent, replaceBookInState, reportError, resetReaderState, setShellVisible, t],
  );

  const closeReader = useCallback(async () => {
    const closing = traceRef.current;
    const sessionId = readingRuntime.snapshot().sessionId;
    readerLoadRequestIdRef.current += 1;
    try {
      await closing?.retire();
      if (readingRuntime.snapshot().sessionId !== sessionId) {
        throw new AppError("reader/superseded", "A new session opened during persistence retirement");
      }
    } catch (error) {
      reportError(error);
      throw error;
    } finally {
      // A late close must never clear a replacement, including the same book.
      if (readingRuntime.snapshot().sessionId === sessionId) {
        readingRuntime.closed();
        traceRef.current = null;
        setTrace(null);
        setSelectedBook(null);
        setShellVisible(false);
        resetReaderState();
        releaseContent();
      }
    }
  }, [releaseContent, reportError, resetReaderState, setShellVisible]);

  const toggleShell = useCallback(() => {
    setShellVisible((visible) => !visible);
  }, [setShellVisible]);

  const openSyncSettings = useCallback(() => {
    void hostSync.openSettings(undefined, "user").catch(reportError);
  }, [reportError]);

  const hideShell = useCallback(
    (origin: DomainActor = "user") => {
      setShellVisible(false, origin);
    },
    [setShellVisible],
  );

  const handleReaderPageChange = useCallback(
    (current: number, total: number) => {
      setReaderPage({ current, total });
    },
    [setReaderPage],
  );

  const handleEpubProgressChange = useCallback(
    (progress: ReaderProgress) => {
      setReaderPage({
        current: progress.currentLocation,
        total: progress.totalLocations,
      });

      if (!selectedBook) return;
      applyReaderProgress(selectedBook.id, progress);
    },
    [applyReaderProgress, selectedBook, setReaderPage],
  );

  const handleReaderFractionChange = useCallback(
    (fraction: number) => {
      setReaderFraction(fraction);
    },
    [setReaderFraction],
  );

  // Scrubbing the header's progress bar. The shell deliberately stays open —
  // the user is working the header, and may well scrub again.
  const handleSeek = useCallback(
    (fraction: number) => {
      setFractionNavigationRequest((previous) => ({
        fraction,
        requestId: (previous?.requestId ?? 0) + 1,
      }));
    },
    [setFractionNavigationRequest],
  );

  const handleChapterSelect = useCallback(
    (href: string) => {
      setChapterNavigationRequest((previous) => ({
        href,
        requestId: (previous?.requestId ?? 0) + 1,
      }));
      setShellVisible(false);
    },
    [setChapterNavigationRequest, setShellVisible],
  );

  const handleAnnotationSelect = useCallback(
    (cfiRange: string) => {
      setAnnotationNavigationRequest((previous) => ({
        cfiRange,
        requestId: (previous?.requestId ?? 0) + 1,
      }));
      setShellVisible(false);
    },
    [setAnnotationNavigationRequest, setShellVisible],
  );

  const overlayVisible = shellVisible;
  const selectedEpubProgress = selectedBook?.progress ?? null;
  // The engine's fraction once it has relocated; before that, the position the
  // book was left at (so the bar opens where reading stopped).
  const readerProgress =
    readerFraction ?? (selectedBook?.progressPercent ? selectedBook.progressPercent / 100 : undefined);

  return {
    selectedBook,
    readerSource,
    readerLoadError,
    readerFailed: !!readerLoadError || (!!trace && failedSessionId === trace.id),
    isReaderLoading,
    readerToc,
    currentChapterHref,
    chapterNavigationRequest,
    annotationNavigationRequest,
    fractionNavigationRequest,
    overlayVisible,
    overlayOrigin,
    selectedEpubProgress,
    readerProgress,
    currentPage: readerPage.current,
    totalPages: readerPage.total,
    openReader,
    closeReader,
    openSyncSettings,
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
