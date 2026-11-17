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
/** Two samples further apart than this mean the webview was suspended
 *  (sleep, occlusion) without telling us; that stretch is never reading. */
export const MAX_SAMPLE_GAP_MS = TICK_MS * 2;
/** Below this, banking waits for more: a sub-second span is a remount
 *  artefact, not reading, and never opens a bucket. */
export const MIN_BANK_MS = 1_000;
export type BucketKey = { bookId: string; localDay: string; localHour: number };

export function bucketKeyAt(bookId: string, epochMs: number): BucketKey {
  return { bookId, localDay: localDayKey(epochMs), localHour: localHour(epochMs) };
}

export function sameBucket(a: BucketKey, b: BucketKey): boolean {
  return a.bookId === b.bookId && a.localDay === b.localDay && a.localHour === b.localHour;
}

/**
 * The reader's active reading time, under the one rule every reading number
 * uses (the statistics and the floating session timer alike): time counts
 * while the window is in the foreground and the reader acted within
 * `IDLE_LIMIT_MS`, and an unobserved gap counts for nothing. Times are
 * monotonic (`performance.now()`); `totalMs` only grows, so each consumer
 * keeps its own mark instead of resetting the clock.
 */
export class ActiveReadingClock {
  #totalMs = 0;
  #lastSampleAt: number;
  #lastActivityAt: number;
  #foreground: boolean;

  constructor(at: number, foreground: boolean) {
    this.#lastSampleAt = at;
    this.#lastActivityAt = at;
    this.#foreground = foreground;
  }

  get totalMs(): number {
    return this.#totalMs;
  }

  /** How long the reader has gone without acting. */
  idleMs(at: number): number {
    return Math.max(0, at - this.#lastActivityAt);
  }

  /** Counts the time since the last sample under the state that held during it. */
  sample(at: number): void {
    const from = this.#lastSampleAt;
    if (at <= from) return;
    this.#lastSampleAt = at;
    if (!this.#foreground || at - from > MAX_SAMPLE_GAP_MS) return;
    const until = Math.min(at, this.#lastActivityAt + IDLE_LIMIT_MS);
    if (until > from) this.#totalMs += until - from;
  }

  /** The reader acted (page turn, pointer, key, a step inside the book). */
  activity(at: number, foreground: boolean): void {
    this.sample(at);
    this.#foreground = foreground;
    if (foreground) this.#lastActivityAt = at;
  }

  /** The window gained or lost the foreground; returning counts as acting. */
  setForeground(at: number, foreground: boolean): void {
    this.sample(at);
    if (foreground && !this.#foreground) this.#lastActivityAt = at;
    this.#foreground = foreground;
  }
}

/** A pause long enough to close the open session. */
export function pausedLongEnough(idleMs: number): boolean {
  return idleMs >= PAUSE_MS;
}
