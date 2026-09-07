import { useCallback, useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { readingStatsAtom } from "../../../state/ui";
import { addReadingTime } from "../lib/reading-stats";
import {
  accrueReadingTime,
  flushReadingTimeBuckets,
  localDayKey,
  localHour,
  type ReadingTimeBucket,
} from "../../../platform/reading-time";
import { createLogger } from "../../../platform/logger";

const log = createLogger("reading-time");

/** How often accumulated time is accrued into the store's buffer. */
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
 * Track active reading time for the open book. Time accrues only while reading
 * is `active` (book rendered), the window is visible and focused, and there
 * has been activity within `IDLE_LIMIT_MS`.
 *
 * Durability is the store's accrual buffer, not the event log: every tick
 * ADDS to a (book, local day, local hour) bucket in `reading_time_pending`
 * (crash-safe — the next boot closes whatever was left open), and the single
 * `book.timeRecorded` event for the bucket is minted only when it CLOSES: the
 * hour rolls over, the book changes, reading stops, the app hides, or the
 * reader unmounts. One event per reading hour, and never a minute lost.
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
  /** The bucket the last accrual landed in, as the store reported it. */
  const openBucketRef = useRef<ReadingTimeBucket | null>(null);
  /** Accruals are serialized: a flush must see the store AFTER the tick
   *  that preceded it, or it would mint an event for stale milliseconds. */
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  bookIdRef.current = bookId;
  activeRef.current = active;

  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  const enqueue = useCallback((work: () => Promise<void>) => {
    chainRef.current = chainRef.current.then(work, work);
  }, []);

  /**
   * Close the open bucket: mint its event with exactly what the store holds.
   * Queued behind every accrual issued so far, so the bucket it reads already
   * includes the tick that preceded the close. `keep` names the bucket the
   * current tick belongs to — never close that one (a stale ref must not turn
   * an ordinary tick into a premature event).
   */
  const flushOpen = useCallback(
    (keep?: { bookId: string; localDay: string; localHour: number }) => {
      enqueue(async () => {
        const bucket = openBucketRef.current;
        if (!bucket || bucket.ms <= 0) return;
        if (keep && sameBucket(bucket, keep)) return;
        openBucketRef.current = null;
        try {
          await flushReadingTimeBuckets([bucket]);
        } catch (error) {
          // The milliseconds stay buffered in the store; the next close (or
          // the next boot) carries them. Nothing is lost, only delayed.
          log.error("flush failed; the bucket stays buffered", error);
        }
      });
    },
    [enqueue],
  );

  // Accrue the time elapsed since the last tick, but only when genuinely
  // reading. Each early return still advances the tick clock so paused spans
  // aren't banked on the next eligible tick.
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

    // Live UI never waits for the store.
    setStats((prev) => addReadingTime(prev, bookId, delta, now));

    const here = { bookId, localDay: localDayKey(now), localHour: localHour(now) };
    // Crossing into a new hour (or book): whatever bucket is open and is not
    // this one is final. Queued before this tick's accrual, so ordering in
    // the store is: close the old bucket, then add to the new.
    flushOpen(here);
    enqueue(async () => {
      try {
        const bucket = await accrueReadingTime(bookId, delta, now);
        if (bucket) openBucketRef.current = bucket;
      } catch (error) {
        // The tick is lost only from the store's buffer (the live UI kept it);
        // the following ticks accrue normally.
        log.error("accrual failed; this tick is not banked", error);
      }
    });
  }, [setStats, flushOpen, enqueue]);

  // Restart the clocks whenever the book changes or reading (de)activates, so
  // a switch never banks the gap as reading time — and close what the
  // PREVIOUS book had open (the bucket carries its own bookId, so this is
  // safe to call after the refs already point at the new book).
  useEffect(() => {
    flushOpen();
    const now = Date.now();
    lastTickRef.current = now;
    lastActivityRef.current = now;
  }, [bookId, active, flushOpen]);

  useEffect(() => {
    const interval = window.setInterval(commit, TICK_MS);

    const onActivity = () => {
      lastActivityRef.current = Date.now();
    };
    // Coming back to the foreground: drop the elapsed gap rather than banking
    // it. Going INTO the background: close the bucket first — a mobile
    // webview may never get another timer tick before the OS kills it, and
    // the event should exist (and sync) rather than wait in the buffer.
    const onResume = () => {
      if (document.visibilityState === "hidden") {
        commit();
        flushOpen();
      }
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
      flushOpen(); // …and close the bucket before tearing down
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("wheel", onActivity);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [commit, flushOpen]);

  return { recordActivity };
}

function sameBucket(
  a: Pick<ReadingTimeBucket, "bookId" | "localDay" | "localHour">,
  b: Pick<ReadingTimeBucket, "bookId" | "localDay" | "localHour">,
): boolean {
  return a.bookId === b.bookId && a.localDay === b.localDay && a.localHour === b.localHour;
}
