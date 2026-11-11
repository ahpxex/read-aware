/**
 * Page turning, section crossing, and the scroll-mode shell dismissal that
 * shares its wheel travel.
 *
 * Extracted from FoliateReaderView. These three concerns are one cluster: they
 * all read the wheel/keyboard travel against the renderer's scroll edges and
 * decide whether it means "scroll", "turn", "cross a section", or "put the
 * chrome away". Every piece of state they need is private to them.
 *
 * The callbacks are also mirrored into refs, because the per-section document
 * listeners are attached once per `load` and must reach the latest closure
 * without being re-attached.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { getScrollEdges, isAtEndOfBook, type FoliateView } from "../lib/foliate-engine";
import type { ReadingMode } from "../../settings/lib/reader-settings";
import { prefersReducedMotion } from "../../settings";

/** Cross-fade timings for a lazy section swap. */
const SECTION_CROSS_FADE_MS = 140;
const SECTION_CROSS_COOLDOWN_MS = 120;
/** Wheel travel past a scroll edge before a section crossing commits. */
const SECTION_CROSS_OVERSCROLL_PX = 220;
/** Idle time after which accumulated overscroll decays back to zero. */
const OVERSCROLL_RESET_MS = 220;
/** Deliberate scroll distance that dismisses the reader shell. */
const SHELL_DISMISS_SCROLL_PX = 90;

type Options = {
  viewRef: RefObject<FoliateView | null>;
  readingModeRef: RefObject<ReadingMode>;
  shellVisibleRef: RefObject<boolean>;
  onContentScrollRef: RefObject<(() => void) | undefined>;
  clearSelection: () => void;
  /**
   * The reader tried to advance past the last page. This is the moment the book
   * is finished — a deliberate forward gesture with nothing left — as opposed to
   * merely scrolling the last page into view.
   */
  onAdvancePastEnd: () => void;
};

type CrossingNavigation = () => Promise<unknown> | void;

/** One cross-fade run: the newest jump waiting for it, and its completion. */
type Crossing = {
  pending: CrossingNavigation | null;
  settled: Promise<void>;
};

export type ReaderPagination = {
  /** True while a section cross-fade is in flight; the view renders hidden. */
  isCrossing: boolean;
  /** Run a navigation behind the cross-fade — for any jump far enough that a
   *  hard swap would read as a glitch rather than a move. Latest wins: a jump
   *  requested mid-crossing lands after it; the promise settles once the view
   *  is at rest. */
  crossTo: (navigate: () => Promise<unknown> | void) => Promise<void>;
  crossSection: (direction: -1 | 1, targetSection?: number) => Promise<void>;
  crossSectionRef: RefObject<(direction: -1 | 1, targetSection?: number) => Promise<void>>;
  handleWheelCrossing: (deltaY: number, threshold?: number) => void;
  handleWheelCrossingRef: RefObject<(deltaY: number, threshold?: number) => void>;
  dismissShellOnScrollDistance: (deltaY: number) => void;
  dismissShellOnScrollDistanceRef: RefObject<(deltaY: number) => void>;
  enqueuePageTurn: (turn: () => Promise<unknown> | void) => void;
  /**
   * Queue a FORWARD turn, or open the completion screen when there is nothing
   * left. Every "next page" entry point goes through here — the keyboard and the
   * wheel page-turn gesture drive `goRight`/`goLeft` directly (RTL-correct)
   * rather than `turnPage`, and each of them has to reach the end the same way.
   */
  advancePage: (turn: () => Promise<unknown> | void) => void;
  turnPage: (direction: -1 | 1) => Promise<void>;
  /** Zero the shell-dismissal travel (the shell opened, or the book changed). */
  resetShellScrollTravel: () => void;
  /** Abandon the previous engine's turn queue when a new book is opened. */
  resetPageTurnQueue: () => void;
  /** Abandon the previous engine's crossing, and any jump queued behind it,
   *  when a new book is opened. */
  resetCrossing: () => void;
};

export function useReaderPagination({
  viewRef,
  readingModeRef,
  shellVisibleRef,
  onContentScrollRef,
  clearSelection,
  onAdvancePastEnd,
}: Options): ReaderPagination {
  const [isCrossing, setIsCrossing] = useState(false);
  const overscrollRef = useRef(0);
  const overscrollResetTimerRef = useRef<number | null>(null);
  /** Signed wheel travel accumulated while the shell is open. */
  const shellScrollAccumRef = useRef(0);

  /** The crossing in flight, or null. See `runCrossing`. */
  const crossingRef = useRef<Crossing | null>(null);

  /**
   * Run a navigation behind a cross-fade: fade the current section out, move
   * while hidden, fade the destination back in, then settle briefly so one
   * wheel push advances a single section.
   *
   * Absolute jumps requested while this runs are not dropped: the newest one
   * is kept in `pending` and applied once the running navigation has settled —
   * still behind the fade when it arrives before the reveal, as a follow-up
   * crossing when it arrives during the settle. Superseded targets are
   * skipped, never replayed. A queued jump belongs to the engine it was aimed
   * at: if the view was replaced (another book, a re-open) it is discarded.
   */
  const runCrossing = useCallback(
    (navigate: CrossingNavigation): Promise<void> => {
      const view = viewRef.current;
      if (!view) return Promise.resolve();
      const crossing: Crossing = { pending: null, settled: Promise.resolve() };
      crossingRef.current = crossing;
      const takePending = (): CrossingNavigation | null => {
        const next = crossing.pending;
        crossing.pending = null;
        return next && viewRef.current === view ? next : null;
      };
      crossing.settled = (async () => {
        const renderer = view.renderer;
        // Stop the old chapter's native momentum before its scroll bounds change.
        // Hiding the content with opacity alone leaves WebKit's scrolling layer live.
        const resumeScroll = renderer && "suspendScroll" in renderer ? renderer.suspendScroll() : undefined;
        // Reduced motion moves without the fade: hiding the page would only
        // add a blank frame between the two sections (a whole extra refresh
        // on an e-ink panel). The settle below still applies.
        const fade = !prefersReducedMotion();
        if (fade) setIsCrossing(true); // fade the current section out
        try {
          if (fade) await new Promise((resolve) => window.setTimeout(resolve, SECTION_CROSS_FADE_MS));
          for (let next: CrossingNavigation | null = navigate; next; next = takePending()) {
            try {
              await next();
            } catch {
              // At the first/last section, or a teardown race — fall through to
              // the next queued jump, or to the reveal.
            }
          }
        } finally {
          resumeScroll?.();
        }
        // The destination has rendered while hidden; reveal it on the next frame,
        // then settle briefly so one push advances a single section. A crossing
        // started for a replacement engine (see resetCrossing) owns the fade
        // from then on, so an abandoned run must not reveal under it.
        const ownsFade = () => crossingRef.current === crossing || crossingRef.current === null;
        window.requestAnimationFrame(() => {
          if (ownsFade()) setIsCrossing(false);
        });
        await new Promise((resolve) => window.setTimeout(resolve, SECTION_CROSS_COOLDOWN_MS));
        if (crossingRef.current === crossing) crossingRef.current = null;
        // A jump that arrived during the settle still lands, as its own crossing.
        const late = takePending();
        if (late) await runCrossing(late);
      })();
      return crossing.settled;
    },
    [viewRef],
  );

  /**
   * Jump behind the cross-fade — to an absolute target (a progress-bar scrub,
   * a fraction), where only the latest request matters. During a crossing the
   * request replaces any queued one and lands after the in-flight navigation;
   * the returned promise settles once the view has come to rest, including any
   * newer jump that superseded this one.
   */
  const crossTo = useCallback(
    (navigate: CrossingNavigation): Promise<void> => {
      const inFlight = crossingRef.current;
      if (!inFlight) return runCrossing(navigate);
      inFlight.pending = navigate;
      return inFlight.settled;
    },
    [runCrossing],
  );

  /**
   * Cross into the adjacent section. Used in scroll mode for the lazy section
   * load (the engine keeps the current TOC chapter's source documents live), and
   * it smooths the otherwise abrupt chapter swap. An explicit `targetSection`
   * jumps straight to that spine index instead of relying on next/prev — which
   * only cross once the viewport is pinned at a section edge.
   *
   * Unlike `crossTo`, a relative step requested during a crossing is dropped:
   * it is the same push's leftover momentum, and replaying it would skip a
   * whole section the reader never saw.
   */
  const crossSection = useCallback(
    async (direction: -1 | 1, targetSection?: number): Promise<void> => {
      if (crossingRef.current) return;
      await runCrossing(() => {
        const view = viewRef.current;
        if (!view) return;
        if (targetSection != null) return view.goTo(targetSection);
        return direction === 1 ? view.next() : view.prev();
      });
    },
    [runCrossing, viewRef],
  );
  const crossSectionRef = useRef(crossSection);
  useEffect(() => {
    crossSectionRef.current = crossSection;
  }, [crossSection]);

  /**
   * Shared wheel-crossing logic: checks scroll edges, accumulates overscroll,
   * and triggers a section cross once past the threshold. Used both by the
   * per-section iframe document listener and the viewport-level fallback for
   * events on the empty area outside the iframe.
   */
  const handleWheelCrossing = useCallback(
    (deltaY: number, threshold: number = SECTION_CROSS_OVERSCROLL_PX) => {
      if (readingModeRef.current !== "scroll") return;
      const edges = getScrollEdges(viewRef.current);
      if (!edges) return;

      const pushingPastEnd = deltaY > 0 && edges.atBottom;
      const pushingPastStart = deltaY < 0 && edges.atTop;
      if (!pushingPastEnd && !pushingPastStart) {
        overscrollRef.current = 0;
        return;
      }

      overscrollRef.current += deltaY;
      if (overscrollResetTimerRef.current != null) {
        window.clearTimeout(overscrollResetTimerRef.current);
      }
      overscrollResetTimerRef.current = window.setTimeout(() => {
        overscrollRef.current = 0;
      }, OVERSCROLL_RESET_MS);

      if (overscrollRef.current >= threshold) {
        overscrollRef.current = 0;
        // Past the end of the LAST section there is nothing to cross into, so
        // the same push means "done" rather than "next chapter".
        if (isAtEndOfBook(viewRef.current)) onAdvancePastEnd();
        else void crossSectionRef.current(1);
      } else if (overscrollRef.current <= -threshold) {
        overscrollRef.current = 0;
        void crossSectionRef.current(-1);
      }
    },
    [onAdvancePastEnd, readingModeRef, viewRef],
  );
  const handleWheelCrossingRef = useRef(handleWheelCrossing);
  useEffect(() => {
    handleWheelCrossingRef.current = handleWheelCrossing;
  }, [handleWheelCrossing]);

  /**
   * Scroll-mode shell dismissal: accumulate the wheel's signed travel while the
   * shell is open and dismiss once a deliberate scroll crosses the threshold.
   * Signing the sum means jitter (down-then-up) cancels rather than racking up a
   * false distance — only sustained movement in one direction dismisses.
   */
  const dismissShellOnScrollDistance = useCallback(
    (deltaY: number) => {
      if (!shellVisibleRef.current || readingModeRef.current !== "scroll") return;
      shellScrollAccumRef.current += deltaY;
      if (Math.abs(shellScrollAccumRef.current) >= SHELL_DISMISS_SCROLL_PX) {
        shellScrollAccumRef.current = 0;
        onContentScrollRef.current?.();
      }
    },
    [onContentScrollRef, readingModeRef, shellVisibleRef],
  );
  const dismissShellOnScrollDistanceRef = useRef(dismissShellOnScrollDistance);
  useEffect(() => {
    dismissShellOnScrollDistanceRef.current = dismissShellOnScrollDistance;
  }, [dismissShellOnScrollDistance]);

  /**
   * The paginator animates a turn over ~300ms and silently drops any
   * navigation issued while one is in flight (its internal lock) — so a second
   * gesture or key press mid-animation would simply vanish. Run turns through
   * a one-slot queue instead: a request made mid-animation lands the moment
   * the current turn settles. The slot keeps only the NEWEST waiting turn —
   * a reversal replaces a stale queued turn rather than playing after it (no
   * bounce), and a held key's auto-repeat can't build a runaway backlog.
   */
  const pageTurnQueueRef = useRef<{
    running: boolean;
    next: (() => Promise<unknown> | void) | null;
  }>({ running: false, next: null });

  const enqueuePageTurn = useCallback((turn: () => Promise<unknown> | void) => {
    const queue = pageTurnQueueRef.current;
    if (queue.running) {
      queue.next = turn;
      return;
    }
    queue.running = true;
    const run = async (current: () => Promise<unknown> | void): Promise<void> => {
      try {
        await current();
      } catch {
        // At the first/last page, or a teardown race during navigation — no-op.
      }
      // Drain whatever is waiting now — unless this queue was abandoned by a
      // book switch, in which case the new book starts from a clean slot.
      if (pageTurnQueueRef.current !== queue) return;
      const next = queue.next;
      queue.next = null;
      if (next) return run(next);
      queue.running = false;
    };
    void run(turn);
  }, []);

  /**
   * Advance, or finish.
   *
   * `isAtEndOfBook` asks the renderer, which already tracks both halves of the
   * question — no following linear section, and the position on the last page —
   * and answers the same way in paginated and scrolled flow.
   */
  const advancePage = useCallback(
    (turn: () => Promise<unknown> | void) => {
      if (isAtEndOfBook(viewRef.current)) {
        onAdvancePastEnd();
        return;
      }
      enqueuePageTurn(turn);
    },
    [enqueuePageTurn, onAdvancePastEnd, viewRef],
  );

  const turnPage = useCallback(
    async (direction: -1 | 1) => {
      const view = viewRef.current;
      if (!view) return;
      if (direction === 1 && isAtEndOfBook(view)) {
        onAdvancePastEnd();
        return;
      }
      // A keyboard/space-driven move in scroll mode scrolls a whole viewport (or
      // crosses a section) — clearly past any distance threshold, so dismiss the
      // shell at once. Paginated turns are handled by the relocate position check.
      if (shellVisibleRef.current && readingModeRef.current === "scroll") {
        onContentScrollRef.current?.();
      }
      // In scroll mode, advancing at a section boundary should cross-fade into the
      // next chapter; mid-section it just scrolls a viewport. Paginated modes flip
      // pages directly.
      if (readingModeRef.current === "scroll") {
        const edges = getScrollEdges(view);
        if ((direction === 1 && edges?.atBottom) || (direction === -1 && edges?.atTop)) {
          void crossSection(direction);
          return;
        }
      }
      clearSelection();
      enqueuePageTurn(() => (direction === 1 ? viewRef.current?.next() : viewRef.current?.prev()));
    },
    [
      clearSelection,
      crossSection,
      enqueuePageTurn,
      onAdvancePastEnd,
      onContentScrollRef,
      readingModeRef,
      shellVisibleRef,
      viewRef,
    ],
  );

  const resetShellScrollTravel = useCallback(() => {
    shellScrollAccumRef.current = 0;
  }, []);

  const resetCrossing = useCallback(() => {
    // The previous engine's crossing (and any jump queued for it) is not the
    // new book's: requests made from now on start their own crossing.
    crossingRef.current = null;
  }, []);

  const resetPageTurnQueue = useCallback(() => {
    // Abandon the previous engine's queue — a turn that never settled (teardown
    // race) must not wedge the running flag against the new book.
    pageTurnQueueRef.current = { running: false, next: null };
  }, []);

  // The decay timer is the only thing here that outlives a render.
  useEffect(
    () => () => {
      if (overscrollResetTimerRef.current != null) {
        window.clearTimeout(overscrollResetTimerRef.current);
      }
    },
    [],
  );

  return {
    isCrossing,
    crossTo,
    crossSection,
    crossSectionRef,
    handleWheelCrossing,
    handleWheelCrossingRef,
    dismissShellOnScrollDistance,
    dismissShellOnScrollDistanceRef,
    enqueuePageTurn,
    advancePage,
    turnPage,
    resetShellScrollTravel,
    resetPageTurnQueue,
    resetCrossing,
  };
}
