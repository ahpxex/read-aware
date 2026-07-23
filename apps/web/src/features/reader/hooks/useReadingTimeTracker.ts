import { useCallback, useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { readingStatsAtom } from "../../../state/ui";
import {
  addReadingTime,
  localDayKey,
  localHour,
  recordReadingTime,
} from "../lib/reading-stats";
import { emitDomainEvents } from "../../../platform/domain-events";

/** How often accumulated time is flushed to the stats seam. */
const TICK_MS = 20_000;
/**
 * Pause counting only after this long with no reading activity — generous so a
 * slow reader lingering on one page isn't cut off. Any page turn / relocate
 * (via `recordActivity`) resets it, and returning to the window resumes
 * immediately, so turning a page and coming back never pauses the timer.
 */
const IDLE_LIMIT_MS = 8 * 60_000;
/** Cap a single tick so a sleep/wake gap can't be counted as reading. */
const MAX_TICK_MS = TICK_MS * 2;

/**
 * Track active reading time for the open book and flush it into the reading-stats
 * seam. Time accrues only while reading is `active` (book rendered), the window
 * is visible and focused, and there has been activity within `IDLE_LIMIT_MS`.
 *
 * Reading happens inside foliate's iframes, whose events don't reach the parent
 * window, so the returned `recordActivity` should be called from the reader's
 * relocate/page callbacks to keep in-book reading from looking idle. Top-level
 * pointer/keyboard activity is also tracked for interaction with app chrome.
 */
export function useReadingTimeTracker(bookId: string | null, active: boolean) {
  const setStats = useSetAtom(readingStatsAtom);
  const bookIdRef = useRef(bookId);
  const activeRef = useRef(active);
  const lastTickRef = useRef(0);
  const lastActivityRef = useRef(0);

  bookIdRef.current = bookId;
  activeRef.current = active;

  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  // Commit the time elapsed since the last tick, but only when genuinely reading.
  // Each early return still advances the tick clock so paused spans aren't banked
  // on the next eligible tick.
  const commit = useCallback(() => {
    const now = Date.now();
    const bookId = bookIdRef.current;
    const idle = now - lastActivityRef.current > IDLE_LIMIT_MS;
    const foreground =
      document.visibilityState === "visible" && document.hasFocus();

    if (!bookId || !activeRef.current || !foreground || idle) {
      lastTickRef.current = now;
      return;
    }

    const delta = Math.min(now - lastTickRef.current, MAX_TICK_MS);
    lastTickRef.current = now;
    if (delta > 0) {
      setStats((prev) => addReadingTime(prev, bookId, delta, now));
      // Write-through into the SQLite projection (the atom is memory-only).
      recordReadingTime(bookId, delta, now);
      // Dual-write into the event log (the sync unit). Local day/hour are
      // stamped NOW, in this device's timezone — replaying later elsewhere
      // must not re-bucket history (see reading.timeRecorded in events.ts).
      emitDomainEvents({
        type: "reading.timeRecorded",
        payload: {
          bookId,
          ms: delta,
          atEpochMs: now,
          localDay: localDayKey(now),
          localHour: localHour(now),
        },
      });
    }
  }, [setStats]);

  // Restart the clocks whenever the book changes or reading (de)activates, so a
  // switch never banks the gap as reading time.
  useEffect(() => {
    const now = Date.now();
    lastTickRef.current = now;
    lastActivityRef.current = now;
  }, [bookId, active]);

  useEffect(() => {
    const interval = window.setInterval(commit, TICK_MS);

    const onActivity = () => {
      lastActivityRef.current = Date.now();
    };
    // Coming back to the foreground: drop the elapsed gap rather than banking it.
    const onResume = () => {
      const now = Date.now();
      lastTickRef.current = now;
      lastActivityRef.current = now;
    };

    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("pointermove", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("wheel", onActivity, { passive: true });
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);

    return () => {
      commit(); // flush the partial tick before tearing down
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("wheel", onActivity);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [commit]);

  return { recordActivity };
}
