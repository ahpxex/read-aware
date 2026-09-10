/**
 * When does a reading session bucket close? Pure decisions over the clock,
 * so the tracker hook stays a thin adapter and the policy is testable
 * without timers or a DOM.
 *
 * A session is one (book, local day, local hour) bucket. It closes — its
 * `book.sessionRecorded` event is minted — at the first of:
 *  - the hour rolling over (buckets never span hours: the stats are hourly,
 *    and a long read simply becomes several sessions);
 *  - the book changing;
 *  - reading pausing for `PAUSE_MS` (the moment another device may take
 *    over, so the position should be on its way);
 *  - the app hiding or the product reading session retiring.
 * None of these has to be exact: a close the device never observes (killed
 * in the background, power loss) is made up at the next boot, and the
 * projection's last-observed-wins rule means a late close can never
 * overwrite a newer position from elsewhere.
 */
import { localDayKey, localHour } from "../../../platform/reading-session";

/** How often accumulated time is accrued into the store's buffer. */
export const TICK_MS = 20_000;
/**
 * Pause counting only after this long with no reading activity — generous so
 * a slow reader lingering on one page isn't cut off. Any page turn /
 * relocate resets it.
 */
export const IDLE_LIMIT_MS = 8 * 60_000;
/** A pause this long closes the open session (position freshness elsewhere). */
export const PAUSE_MS = 2 * 60_000;
/** Cap a single tick so a sleep/wake gap can't be counted as reading. */
export const MAX_TICK_MS = TICK_MS * 2;
/** Below this a "tick" is a remount artefact (cleanup firing a millisecond
 *  after the clocks reset), not reading; it never opens a bucket. */
export const MIN_TICK_MS = 1_000;
export type BucketKey = { bookId: string; localDay: string; localHour: number };

export function bucketKeyAt(bookId: string, epochMs: number): BucketKey {
  return { bookId, localDay: localDayKey(epochMs), localHour: localHour(epochMs) };
}

export function sameBucket(a: BucketKey, b: BucketKey): boolean {
  return a.bookId === b.bookId && a.localDay === b.localDay && a.localHour === b.localHour;
}

/**
 * Active reading time to bank for a tick at `now`: zero unless the reader is
 * genuinely reading (book rendered, window foreground, activity within the
 * idle limit), capped so a sleep/wake gap never counts.
 */
export function tickDelta(input: {
  now: number;
  lastTickAt: number;
  lastActivityAt: number;
  active: boolean;
  foreground: boolean;
}): number {
  const { now, lastTickAt, lastActivityAt, active, foreground } = input;
  if (!active || !foreground) return 0;
  if (now - lastActivityAt > IDLE_LIMIT_MS) return 0;
  const delta = Math.min(now - lastTickAt, MAX_TICK_MS);
  return delta < MIN_TICK_MS ? 0 : delta;
}

/** A pause long enough to close the open session. */
export function pausedLongEnough(now: number, lastActivityAt: number): boolean {
  return now - lastActivityAt >= PAUSE_MS;
}
