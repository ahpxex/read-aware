import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryBook } from "../features/library/lib/library-types";
import { prefersReducedMotion } from "../features/settings/lib/app-settings";
import { AppError } from "@read-aware/core";

/**
 * Orchestrates the shelf ⇄ reader surface handoff (see App.tsx for the
 * rendering side). Both directions follow two rules:
 *
 * 1. The INCOMING surface renders fully opaque at once; only the OUTGOING
 *    surface fades, as a fixed overlay on top (ra-motion-surface-exit) — two
 *    simultaneous fades let the body background flash through the overlap.
 * 2. Opening adds no time of its own to what the book takes. The shelf HOLDS
 *    opaque over the mounting reader so a fast open goes straight from the
 *    shelf to the page, and dissolves the moment the reader has rendered
 *    (page counters / error). A slow open (a phone, a very large book) does
 *    not leave the shelf frozen under the reader's finger: once the hold has
 *    run its budget the shelf dissolves into the reader's own page surface,
 *    and the text arrives there when it is ready.
 *
 * The dissolve is short enough to need no clear main thread: opening a book
 * keeps the thread busy past its first render, and a fade that starves there
 * reads as a cut, which is where it would have ended anyway. (It used to
 * wait for frames to flow again and then run for a quarter of a second,
 * which made every open several hundred milliseconds longer than its work.)
 *
 * Closing needs no hold — teardown is cheap — but the reader must keep its
 * book state while it fades, so `closeReader()` is deferred to the fade end.
 */

type ReaderSessionSlice = {
  selectedBook: LibraryBook | null;
  /** A session-level load error or an engine failure: either shows the error surface. */
  readerFailed: boolean;
  currentPage: number;
  totalPages: number;
  openReader: (book: LibraryBook, navigationIntent?: number) => void;
  closeReader: () => Promise<void>;
};

export type ShelfHandoff = "idle" | "holding" | "fading";

/** The ra-motion-surface-exit animation (140ms) plus a small margin. */
const EXIT_FADE_MS = 160;
/** Deferred close teardown; tracks the same exit animation. */
export const CLOSE_TEARDOWN_MS = 150;
/**
 * How long the shelf holds for a reader that has not rendered yet. Long
 * enough that an ordinary open never shows the bare page first; short enough
 * that the app has visibly answered the tap before it reads as stuck.
 */
export const HOLD_BUDGET_MS = 400;

export function useSurfaceHandoff(reader: ReaderSessionSlice) {
  const { openReader, closeReader } = reader;
  const [shelfHandoff, setShelfHandoff] = useState<ShelfHandoff>("idle");
  const [readerExiting, setReaderExiting] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);
  const closingRef = useRef<{ promise: Promise<void>; reject(error: unknown): void } | null>(null);
  const holdStartRef = useRef(0);

  const openBook = useCallback(
    (book: LibraryBook, navigationIntent?: number) => {
      // Validate the navigation intent before changing the transition state.
      openReader(book, navigationIntent);
      // A reopen during the close fade must cancel the deferred teardown, or
      // it would tear down the freshly opened book a beat later.
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      closingRef.current?.reject(new AppError("reader/superseded", "Book reopened during close transition"));
      closingRef.current = null;
      setReaderExiting(false);
      // Same-batch as openReader's state so the shelf never unmounts between
      // renders (a one-frame flash of the raw reader).
      holdStartRef.current = performance.now();
      setShelfHandoff(prefersReducedMotion() ? "idle" : "holding");
    },
    [openReader],
  );

  const closeBook = useCallback(() => {
    if (closingRef.current) return closingRef.current.promise;
    setShelfHandoff("idle");
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const closing = { promise, reject };
    closingRef.current = closing;
    // UI event handlers do not await; persistence errors are presented by
    // closeReader. Keep the original rejection observable to the runtime.
    void promise.catch(() => {});
    const finish = () => {
      closeTimeoutRef.current = null;
      void closeReader()
        .then(resolve, reject)
        .finally(() => {
          if (closingRef.current !== closing) return;
          closingRef.current = null;
          setReaderExiting(false);
        });
    };
    if (prefersReducedMotion()) finish();
    else {
      setReaderExiting(true);
      closeTimeoutRef.current = window.setTimeout(finish, CLOSE_TEARDOWN_MS);
    }
    return promise;
  }, [closeReader]);

  // The first relocate populates the page counters; a load failure shows the
  // error surface. Either counts as "the reader has something to show".
  const readerHasRendered = reader.readerFailed || reader.currentPage > 0 || reader.totalPages > 0;

  // Holding → fading: at once when the reader has something to show, else
  // when the hold has run its budget.
  useEffect(() => {
    if (shelfHandoff !== "holding") return;
    if (!reader.selectedBook) {
      setShelfHandoff("idle");
      return;
    }
    if (readerHasRendered) {
      setShelfHandoff("fading");
      return;
    }
    const remaining = Math.max(0, HOLD_BUDGET_MS - (performance.now() - holdStartRef.current));
    const budget = window.setTimeout(() => setShelfHandoff("fading"), remaining);
    return () => window.clearTimeout(budget);
  }, [shelfHandoff, reader.selectedBook, readerHasRendered]);

  // Fading → idle when the exit animation has played out.
  useEffect(() => {
    if (shelfHandoff !== "fading") return;
    const timeout = window.setTimeout(() => {
      setShelfHandoff("idle");
    }, EXIT_FADE_MS);
    return () => window.clearTimeout(timeout);
  }, [shelfHandoff]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) window.clearTimeout(closeTimeoutRef.current);
      closingRef.current?.reject(new AppError("reader/unavailable", "Reader surface unmounted during close"));
    };
  }, []);

  return { shelfHandoff, readerExiting, openBook, closeBook };
}
