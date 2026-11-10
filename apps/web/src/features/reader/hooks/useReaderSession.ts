import { useCallback, useEffect, useRef, useState } from "react";
import { describeError, useTranslation } from "../../../i18n";
import { useLocalAtom } from "@read-aware/ui/state";
import {
  acquireBookContent,
  BookSourceMissingError,
  contentInvalidationRevision,
  observeContentInvalidation,
  type BookContentLease,
} from "../../library";
import { onAppEvent } from "../../../platform/app-events";
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
  // The book being read. Null on the shelf, even while the reader stands by
  // with a book (`surfaceBook`): everything that asks "is a book open?" asks this.
  const [selectedBook, setSelectedBook] = useState<LibraryBook | null>(null);
  const selectedBookRef = useRef<LibraryBook | null>(null);
  useEffect(() => {
    selectedBookRef.current = selectedBook;
  }, [selectedBook]);
  /**
   * The book the reader surface holds: the one being read, or one it stands
   * by with — mounted behind the shelf, parsed, laid out at its saved place,
   * with no reading session. Closing a book leaves it standing, and the shelf
   * can ask for the likeliest next book to be made ready (`standbyBook`).
   * Opening that book is then only a session starting on what is there.
   */
  const [surfaceBook, setSurfaceBook] = useState<LibraryBook | null>(null);
  const surface = useRef<{ bookId: string; invalidation: string; ready: boolean } | null>(null);
  const [trace, setTrace] = useState<ReadingTrace | null>(null);
  const traceRef = useRef<ReadingTrace | null>(null);
  const [readerSource, setReaderSource] = useState<ReaderSource>(null);
  const [readerLoadError, setReaderLoadError] = useState<ReaderLoadError | null>(null);
  const readerLoadErrorRef = useRef<ReaderLoadError | null>(null);
  useEffect(() => {
    readerLoadErrorRef.current = readerLoadError;
  }, [readerLoadError]);
  const [isReaderLoading, setIsReaderLoading] = useState(false);
  // The engine reports parse/render failures to the reading runtime rather
  // than through this hook. The surface handoff needs them too: otherwise it
  // keeps the shelf over a reader that will never paint a page until its
  // fallback timeout, and the error surface appears seconds late.
  const [failedSessionId, setFailedSessionId] = useState<string | null>(null);
  const failedSessionRef = useRef<string | null>(null);
  useEffect(
    () =>
      readingRuntime.observe((state) => {
        if (state.status === "error" && state.sessionId) {
          failedSessionRef.current = state.sessionId;
          setFailedSessionId(state.sessionId);
        }
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

  /** Let go of the book the surface holds: nothing is mounted for it and its content is given back. */
  const unloadSurface = useCallback(() => {
    readerLoadRequestIdRef.current += 1;
    surface.current = null;
    setSurfaceBook(null);
    resetReaderState();
    setIsReaderLoading(false);
    releaseContent();
  }, [releaseContent, resetReaderState]);

  /**
   * Put `book` in the reader surface. Its content is found and parsed from
   * this moment, alongside the reader mounting and building its engine; the
   * engine picks the result up. A failure is the reading session's when the
   * book is being read by then, and otherwise only ends the standing.
   */
  const loadSurface = useCallback(
    (book: LibraryBook, options: { resetPosition?: true; fetchMissing: boolean }): Promise<BookContentLease> => {
      const requestId = readerLoadRequestIdRef.current + 1;
      readerLoadRequestIdRef.current = requestId;
      const held = { bookId: book.id, invalidation: contentInvalidationRevision(book.id), ready: false };
      surface.current = held;
      setSurfaceBook(book);
      resetReaderState();
      setIsReaderLoading(true);

      const binding = book.format === "virtual" ? getVirtualBookBinding(book.id) : null;
      const lease =
        book.format === "virtual" && !binding
          ? Promise.reject<BookContentLease>(new Error("This book's plugin content source is not available."))
          : acquireBookContent(book.id, { fetchMissing: options.fetchMissing });
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
          resetPosition: options.resetPosition,
        },
      });

      lease.then(
        () => {
          if (readerLoadRequestIdRef.current !== requestId) return;
          held.ready = true;
          setIsReaderLoading(false);
        },
        (error: unknown) => {
          if (readerLoadRequestIdRef.current !== requestId) return;
          const session = readingRuntime.snapshot();
          const sessionId = session.bookId === book.id ? session.sessionId : null;
          if (!sessionId) {
            // Nobody asked for this book yet: there is nothing to tell them.
            log.warn("a book could not be made ready ahead of opening", error);
            unloadSurface();
            return;
          }
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
      return lease;
    },
    [releaseContent, resetReaderState, t, unloadSurface],
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

      setSelectedBook(book);
      setShellVisible(false, openingActor);
      // The reader already stands by with this book, as it was left or as it
      // was made ready: the session starts on what is there. Anything else —
      // another book, a reload, content that changed since, a book still
      // being made ready (which may not fetch a missing file) — is loaded.
      const standing = surface.current;
      const lease =
        !options?.resetPosition &&
        standing?.bookId === book.id &&
        standing.ready &&
        standing.invalidation === contentInvalidationRevision(book.id) &&
        contentLease.current
          ? contentLease.current
          : loadSurface(book, { resetPosition: options?.resetPosition, fetchMissing: true });
      // The latest record of the book: its progress may have moved since the reader stood by with it.
      setSurfaceBook(book);

      lease.then(
        () => {
          if (readingRuntime.snapshot().sessionId !== sessionId) return;
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
        // Reported where the surface was loaded.
        () => {},
      );
    },
    [controls, loadSurface, replaceBookInState, reportError, setShellVisible],
  );

  /**
   * Make `book` ready in the reader while the shelf is showing, so opening it
   * is immediate. Ignored while a book is being read, for the book the reader
   * already holds, and for plugin-provided books, whose content is resolved
   * by each opening.
   */
  const standbyBook = useCallback(
    (book: LibraryBook) => {
      if (readingRuntime.snapshot().sessionId || surface.current?.bookId === book.id || book.format === "virtual")
        return;
      setReaderLoadError(null);
      // Never from the relay: a book that is not on this device waits to be asked for.
      void loadSurface(book, { fetchMissing: false }).catch(() => {
        // Reported where the surface was loaded.
      });
    },
    [loadSurface],
  );

  /** The standing engine failed, or what it stood on is gone: a later opening starts over. */
  const dropStandby = useCallback(
    (bookId?: string) => {
      if (readingRuntime.snapshot().sessionId) return;
      if (bookId && surface.current?.bookId !== bookId) return;
      unloadSurface();
    },
    [unloadSurface],
  );
  useEffect(() => {
    const offInvalidation = observeContentInvalidation((bookId) => dropStandby(bookId));
    const offRemoval = onAppEvent("book-removed", ({ bookId }) => dropStandby(bookId));
    return () => {
      offInvalidation();
      offRemoval();
    };
  }, [dropStandby]);

  const closeReader = useCallback(async () => {
    const closing = traceRef.current;
    const sessionId = readingRuntime.snapshot().sessionId;
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
        const failed = !!readerLoadErrorRef.current || failedSessionRef.current === sessionId;
        const left = selectedBookRef.current;
        readingRuntime.closed();
        traceRef.current = null;
        setTrace(null);
        setSelectedBook(null);
        setShellVisible(false);
        // The reader keeps the book, standing by where it was left, so that
        // coming back to it is immediate. One that never opened is let go.
        if (failed || !left || surface.current?.bookId !== left.id) unloadSurface();
        else setSurfaceBook(left);
      }
    }
  }, [reportError, setShellVisible, unloadSurface]);

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
  // The reader shows the book it holds, read or standing.
  const readerBook = selectedBook ?? surfaceBook;
  const selectedEpubProgress = readerBook?.progress ?? null;
  // The engine's fraction once it has relocated; before that, the position the
  // book was left at (so the bar opens where reading stopped).
  const readerProgress = readerFraction ?? (readerBook?.progressPercent ? readerBook.progressPercent / 100 : undefined);

  return {
    selectedBook,
    /** The book in the reader surface: the one being read, or one it stands by with. */
    readerBook,
    /** Nobody is reading the book the reader holds. */
    standby: !selectedBook && !!surfaceBook,
    standbyBook,
    dropStandby,
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
