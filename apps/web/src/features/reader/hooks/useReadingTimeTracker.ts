import { useCallback, useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { readingStatsAtom } from "../../../state/ui";
import { addReadingTime, localDayKey, localHour } from "../lib/reading-stats";
import { commitDomainEvents } from "../../../platform/domain-events";
import { createLogger } from "../../../platform/logger";

const log = createLogger("reading-time");

/** How often accumulated time is flushed to the stats seam. */
const TICK_MS = 20_000;
/**
 * How long an event bucket may accumulate before its safety flush. The log
 * event's granularity is the (localDay, localHour) bucket — committing every
 * tick used to write ~180 events per reading hour that said no more than 12
 * do. Five minutes bounds what a crash can lose while cutting the dominant
 * event type ~15x (measured: timeRecorded was 90% of a 19k-event log).
 */
const FLUSH_MS = 5 * 60_000;
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
/** Accrued-but-uncommitted time, keyed by its hour bucket. */
type PendingBucket = {
  bookId: string;
  localDay: string;
  localHour: number;
  ms: number;
  startedAt: number;
  lastAt: number;
};

export function useReadingTimeTracker(bookId: string | null, active: boolean) {
  const setStats = useSetAtom(readingStatsAtom);
  const bookIdRef = useRef(bookId);
  const activeRef = useRef(active);
  const lastTickRef = useRef(0);
  const lastActivityRef = useRef(0);
  const pendingRef = useRef<PendingBucket | null>(null);

  bookIdRef.current = bookId;
  activeRef.current = active;

  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  // Turn the pending bucket into its one log event. The event IS the durable
  // write: committing appends to the log and adds the sum to the reading_time
  // projections in one transaction, bucketed by the day/hour the time was
  // READ in (this device's timezone — replaying elsewhere must not re-bucket
  // history; see book.timeRecorded in events.ts). Live UI never waits for
  // this: the stats atom advances every tick.
  const flushPending = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending || pending.ms <= 0) return;
    void commitDomainEvents({
      type: "book.timeRecorded",
      payload: {
        bookId: pending.bookId,
        ms: pending.ms,
        atEpochMs: pending.lastAt,
        localDay: pending.localDay,
        localHour: pending.localHour,
      },
    }).catch((error) => {
      log.error("flush failed; this bucket is not banked", error);
    });
  }, []);

  // Accrue the time elapsed since the last tick, but only when genuinely
  // reading. Each early return still advances the tick clock so paused spans
  // aren't banked on the next eligible tick. Accrual is in-memory: the event
  // flushes when the hour bucket changes, when the safety interval elapses,
  // or when reading stops — at most FLUSH_MS is lost to a hard crash.
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
    if (delta <= 0) return;

    setStats((prev) => addReadingTime(prev, bookId, delta, now));

    const day = localDayKey(now);
    const hour = localHour(now);
    const pending = pendingRef.current;
    if (
      pending &&
      (pending.bookId !== bookId || pending.localDay !== day || pending.localHour !== hour)
    ) {
      // Crossing into a new hour (or book): the old bucket is final.
      flushPending();
    }
    const current = pendingRef.current;
    if (current) {
      current.ms += delta;
      current.lastAt = now;
    } else {
      pendingRef.current = {
        bookId,
        localDay: day,
        localHour: hour,
        ms: delta,
        startedAt: now,
        lastAt: now,
      };
    }
    if (pendingRef.current && now - pendingRef.current.startedAt >= FLUSH_MS) {
      flushPending();
    }
  }, [setStats, flushPending]);

  // Restart the clocks whenever the book changes or reading (de)activates, so
  // a switch never banks the gap as reading time — and flush what the
  // PREVIOUS book had pending (the bucket carries its own bookId, so this is
  // safe to call after the refs already point at the new book).
  useEffect(() => {
    flushPending();
    const now = Date.now();
    lastTickRef.current = now;
    lastActivityRef.current = now;
  }, [bookId, active, flushPending]);

  useEffect(() => {
    const interval = window.setInterval(commit, TICK_MS);

    const onActivity = () => {
      lastActivityRef.current = Date.now();
    };
    // Coming back to the foreground: drop the elapsed gap rather than banking
    // it. Going INTO the background: bank what's pending first — a mobile
    // webview may never get another timer tick before the OS kills it.
    const onResume = () => {
      if (document.visibilityState === "hidden") flushPending();
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
      commit(); // accrue the partial tick…
      flushPending(); // …and bank it before tearing down
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("wheel", onActivity);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [commit, flushPending]);

  return { recordActivity };
}
