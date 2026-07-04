import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryBook } from "../features/library/lib/library-types";
import { prefersReducedMotion } from "../features/settings/lib/app-settings";

/**
 * Orchestrates the shelf ⇄ reader surface handoff (see App.tsx for the
 * rendering side). Both directions follow two rules:
 *
 * 1. The INCOMING surface renders fully opaque at once; only the OUTGOING
 *    surface fades, as a fixed overlay on top (ra-motion-surface-exit) — two
 *    simultaneous fades let the body background flash through the overlap.
 * 2. The fade starts only when the main thread can actually animate it.
 *    Opening a book does heavy work (engine load, parsing, first layout —
 *    and for large PDFs it keeps going well past the first render) that
 *    starves rendering: a fade started under load freezes at opacity 1 and
 *    then pops. So the shelf HOLDS opaque over the mounting reader and
 *    dissolves only once the reader has rendered (page counters / error)
 *    AND frames are flowing again (consecutive fast rAF deltas).
 *
 * Closing needs no hold — teardown is cheap — but the reader must keep its
 * book state while it fades, so `closeReader()` is deferred to the fade end.
 */

type ReaderSessionSlice = {
  selectedBook: LibraryBook | null;
  readerLoadError: string | null;
  currentPage: number;
  totalPages: number;
  openReader: (book: LibraryBook) => void;
  closeReader: () => void;
};

export type ShelfHandoff = "idle" | "holding" | "fading";

/** The ra-motion-surface-exit animation (240ms) plus a small margin. */
const EXIT_FADE_MS = 280;
/** Deferred close teardown; tracks the same exit animation. */
const CLOSE_TEARDOWN_MS = 260;
/** With no render signal, consider the reader eligible after this long. */
const RENDER_SIGNAL_TIMEOUT_MS = 3000;
/** Once eligible, fade at latest after this — even if frames never smooth out. */
const ELIGIBLE_GRACE_MS = 800;
/** Absolute cap on holding. */
const HOLD_HARD_CAP_MS = 6000;
/** A rAF delta under this counts as a smooth frame. */
const SMOOTH_FRAME_MS = 50;
/** Consecutive smooth frames required before the fade may start early. */
const SMOOTH_FRAMES_REQUIRED = 3;

export function useSurfaceHandoff(reader: ReaderSessionSlice) {
  const [shelfHandoff, setShelfHandoff] = useState<ShelfHandoff>("idle");
  const [readerExiting, setReaderExiting] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);
  const holdStartRef = useRef(0);

  const openBook = useCallback(
    (book: LibraryBook) => {
      // A reopen during the close fade must cancel the deferred teardown, or
      // it would tear down the freshly opened book a beat later.
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      setReaderExiting(false);
      // Same-batch as openReader's state so the shelf never unmounts between
      // renders (a one-frame flash of the raw reader).
      holdStartRef.current = performance.now();
      setShelfHandoff(prefersReducedMotion() ? "idle" : "holding");
      reader.openReader(book);
    },
    [reader.openReader],
  );

  const closeBook = useCallback(() => {
    if (closeTimeoutRef.current !== null) return; // already closing
    setShelfHandoff("idle");
    if (prefersReducedMotion()) {
      reader.closeReader();
      return;
    }
    setReaderExiting(true);
    closeTimeoutRef.current = window.setTimeout(() => {
      closeTimeoutRef.current = null;
      setReaderExiting(false);
      reader.closeReader();
    }, CLOSE_TEARDOWN_MS);
  }, [reader.closeReader]);

  // The first relocate populates the page counters; a load failure shows the
  // error surface. Either counts as "the reader has something to show".
  const readerHasRendered =
    !!reader.readerLoadError || reader.currentPage > 0 || reader.totalPages > 0;

  // Holding → fading. The rAF loop is the FAST path: once the reader is
  // eligible and frames flow smoothly again, fade immediately. The timeout is
  // the FAILSAFE path: rAF can be throttled or fully paused (occluded window,
  // sustained main-thread starvation), so state progression must never depend
  // on it — once eligible, fade after a bounded grace even without smooth
  // frames, and never hold past the hard cap.
  useEffect(() => {
    if (shelfHandoff !== "holding") return;
    if (!reader.selectedBook) {
      setShelfHandoff("idle");
      return;
    }

    const heldFor = performance.now() - holdStartRef.current;
    const untilEligible = readerHasRendered
      ? 0
      : Math.max(0, RENDER_SIGNAL_TIMEOUT_MS - heldFor);
    const failsafeDelay = Math.min(
      untilEligible + ELIGIBLE_GRACE_MS,
      Math.max(0, HOLD_HARD_CAP_MS - heldFor),
    );
    const failsafe = window.setTimeout(() => setShelfHandoff("fading"), failsafeDelay);

    let rafId = 0;
    let cancelled = false;
    let lastFrameAt = performance.now();
    let smoothFrames = 0;
    const tick = (now: number) => {
      if (cancelled) return;
      smoothFrames = now - lastFrameAt < SMOOTH_FRAME_MS ? smoothFrames + 1 : 0;
      lastFrameAt = now;
      const eligible =
        readerHasRendered ||
        now - holdStartRef.current > RENDER_SIGNAL_TIMEOUT_MS;
      if (eligible && smoothFrames >= SMOOTH_FRAMES_REQUIRED) {
        setShelfHandoff("fading");
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      window.clearTimeout(failsafe);
    };
  }, [shelfHandoff, reader.selectedBook, readerHasRendered]);

  // Fading → idle when the exit animation has played out.
  useEffect(() => {
    if (shelfHandoff !== "fading") return;
    const timeout = window.setTimeout(() => setShelfHandoff("idle"), EXIT_FADE_MS);
    return () => window.clearTimeout(timeout);
  }, [shelfHandoff]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) window.clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  return { shelfHandoff, readerExiting, openBook, closeBook };
}
