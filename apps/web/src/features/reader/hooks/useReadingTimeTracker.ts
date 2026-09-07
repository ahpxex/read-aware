import { useCallback, useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { readingStatsAtom } from "../../../state/ui";
import { addReadingTime } from "../lib/reading-stats";
import {
  accrueReadingSession,
  flushReadingSessions,
  listPendingReadingSessions,
} from "../../../platform/reading-session";
import {
  bucketKeyAt,
  pausedLongEnough,
  sameBucket,
  TICK_MS,
  tickDelta,
  UNMOUNT_CLOSE_DELAY_MS,
  type BucketKey,
} from "../lib/reading-session-policy";
import { createLogger } from "../../../platform/logger";

const log = createLogger("reading-session");

/**
 * An unmount's close, deferred: the reader workspace remounts when a book
 * opens, and the new instance for the SAME book cancels the close its
 * predecessor scheduled — otherwise every open would mint an empty session
 * from the bucket the first relocate had just opened. A real close (nothing
 * remounts) fires it after the delay. Module-level so it survives the
 * instance that scheduled it.
 */
let deferredClose: { bookId: string | null; timer: number } | null = null;

/**
 * Track the reading session for the open book: active time AND position.
 *
 * Durability is the store's scratch pad, not the event log: every tick ADDS
 * to a (book, local day, local hour) bucket in `reading_sessions_pending`
 * and every page turn OVERWRITES the bucket's position (crash-safe — the
 * next boot closes whatever was left open). The single
 * `book.sessionRecorded` event for the bucket is minted only when it CLOSES
 * (`reading-session-policy.ts`): the hour rolls over, the book changes,
 * reading pauses, the app hides, or the reader unmounts. One event per
 * reading hour, carrying where the reader stopped and how long they read.
 *
 * Positions reach the same buckets through `noteReadingPosition`
 * (platform/reading-session.ts), called by the reader session's progress
 * path; a close reads the bucket back from the store, so whatever landed —
 * ticks from here, page turns from there — is in the event.
 *
 * Reading happens inside foliate's iframes, whose events don't reach the
 * parent window, so the returned `recordActivity` should be called from the
 * reader's relocate/page callbacks to keep in-book reading from looking
 * idle. Top-level pointer/keyboard activity is also tracked for interaction
 * with app chrome.
 */
export function useReadingTimeTracker(bookId: string | null, active: boolean) {
  const setStats = useSetAtom(readingStatsAtom);
  const bookIdRef = useRef(bookId);
  const activeRef = useRef(active);
  const lastTickRef = useRef(0);
  const lastActivityRef = useRef(0);
  /** The bucket the last accrual landed in. */
  const openKeyRef = useRef<BucketKey | null>(null);
  /** Whether the open bucket has already been closed for the current pause. */
  const pauseClosedRef = useRef(false);
  /** Store writes are serialized: a close must see the store AFTER the tick
   *  or page turn that preceded it, or it would mint a stale session. */
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  bookIdRef.current = bookId;
  activeRef.current = active;

  const enqueue = useCallback((work: () => Promise<void>) => {
    chainRef.current = chainRef.current.then(work, work);
  }, []);

  /**
   * Close every open bucket except `keep` (the bucket the current tick
   * belongs to): read them back from the store — so page turns noted by the
   * progress path are included — and mint their events. Queued behind every
   * accrual issued so far, so the bucket already holds the tick that
   * preceded the close.
   */
  const closeOpen = useCallback(
    (keep?: BucketKey) => {
      enqueue(async () => {
        let pending;
        try {
          pending = await listPendingReadingSessions();
        } catch (error) {
          log.error("could not read open sessions; they stay buffered", error);
          return;
        }
        const closing = pending.filter((b) => !(keep && sameBucket(b, keep)));
        if (closing.length === 0) return;
        if (!keep || !openKeyRef.current || !sameBucket(openKeyRef.current, keep)) {
          openKeyRef.current = null;
        }
        try {
          await flushReadingSessions(closing);
        } catch (error) {
          // The buckets stay in the store; the next close (or the next
          // boot) carries them. Nothing is lost, only delayed.
          log.error("session close failed; the buckets stay buffered", error);
        }
      });
    },
    [enqueue],
  );

  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    pauseClosedRef.current = false;
  }, []);

  // Accrue the time elapsed since the last tick, but only when genuinely
  // reading. Each tick advances the clock so paused spans are never banked on
  // the next eligible tick; a long enough pause closes the open session.
  const commit = useCallback(() => {
    const now = Date.now();
    const bookId = bookIdRef.current;
    const foreground =
      document.visibilityState === "visible" && document.hasFocus();
    const delta = tickDelta({
      now,
      lastTickAt: lastTickRef.current,
      lastActivityAt: lastActivityRef.current,
      active: Boolean(bookId) && activeRef.current,
      foreground,
    });
    lastTickRef.current = now;

    if (!pauseClosedRef.current && pausedLongEnough(now, lastActivityRef.current)) {
      pauseClosedRef.current = true;
      closeOpen();
    }
    if (!bookId || delta <= 0) return;

    // Live UI never waits for the store.
    setStats((prev) => addReadingTime(prev, bookId, delta, now));

    const here = bucketKeyAt(bookId, now);
    // Crossing into a new hour (or book): whatever bucket is open and is not
    // this one is final. Queued before this tick's accrual, so ordering in
    // the store is: close the old bucket, then add to the new.
    closeOpen(here);
    enqueue(async () => {
      try {
        const bucket = await accrueReadingSession(bookId, delta, now);
        if (bucket) openKeyRef.current = here;
      } catch (error) {
        // The tick is lost only from the store's buffer (the live UI kept it);
        // the following ticks accrue normally.
        log.error("accrual failed; this tick is not banked", error);
      }
    });
  }, [setStats, closeOpen, enqueue]);

  // Restart the clocks whenever the book changes or reading (de)activates, so
  // a switch never banks the gap as reading time — and close what the
  // PREVIOUS book had open. The book now being read keeps its bucket: the
  // reader's first relocate already noted a position, and closing that would
  // mint an empty session at every open.
  useEffect(() => {
    const now = Date.now();
    if (deferredClose && deferredClose.bookId === bookId && active) {
      // A remount for the same book: the previous instance's session goes on.
      window.clearTimeout(deferredClose.timer);
      deferredClose = null;
    }
    closeOpen(bookId && active ? bucketKeyAt(bookId, now) : undefined);
    lastTickRef.current = now;
    lastActivityRef.current = now;
    pauseClosedRef.current = false;
  }, [bookId, active, closeOpen]);

  useEffect(() => {
    const interval = window.setInterval(commit, TICK_MS);

    const onActivity = () => {
      lastActivityRef.current = Date.now();
      pauseClosedRef.current = false;
    };
    // Coming back to the foreground: drop the elapsed gap rather than banking
    // it. Going INTO the background: close the session first — a mobile
    // webview may never get another timer tick before the OS kills it, and
    // the event should exist (and sync) rather than wait in the buffer.
    const onResume = () => {
      if (document.visibilityState === "hidden") {
        commit();
        closeOpen();
      }
      const now = Date.now();
      lastTickRef.current = now;
      lastActivityRef.current = now;
      pauseClosedRef.current = false;
    };

    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("pointermove", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("wheel", onActivity, { passive: true });
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);

    return () => {
      commit(); // accrue the partial tick…
      // …and close the session — unless this is a remount (see deferredClose).
      if (deferredClose) window.clearTimeout(deferredClose.timer);
      deferredClose = {
        bookId: bookIdRef.current,
        timer: window.setTimeout(() => {
          deferredClose = null;
          closeOpen();
        }, UNMOUNT_CLOSE_DELAY_MS),
      };
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("wheel", onActivity);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [commit, closeOpen]);

  return { recordActivity };
}
