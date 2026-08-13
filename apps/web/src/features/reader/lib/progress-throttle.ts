/**
 * Commit-side throttle for `book.progressed` (docs/sync-engine.md §11).
 *
 * Every page turn used to become a log event (behind a 250ms debounce), which
 * is exactly the log-bloat failure mode the sync design calls out: the log is
 * append-only, synced, and immutable — the place to be frugal is BEFORE the
 * commit, not compaction after. Policy: a chapter change commits promptly (it
 * is a real waypoint), everything else coalesces to one commit per interval,
 * and the latest position always wins. The optimistic UI patch is untouched —
 * only the event cadence changes.
 *
 * Timers are injected so the policy is testable without wall time.
 */
import type { BookProgress } from "../../library/lib/library-types";

type Scheduler = {
  schedule(fn: () => void, ms: number): number;
  cancel(id: number): void;
};

type BookState = {
  pending: BookProgress | undefined;
  timer: number | null;
  lastCommitAt: number;
  lastChapterHref: string | null;
};

export type ProgressThrottle = {
  queue(bookId: string, progress: BookProgress): void;
  /** Commit everything still pending, now. Called on unmount — a reading
   * position must survive closing the book. */
  flushAll(): void;
  dispose(): void;
};

export function createProgressThrottle(
  commit: (bookId: string, progress: BookProgress) => void,
  {
    commitIntervalMs = 30_000,
    debounceMs = 250,
    now = Date.now,
    scheduler = {
      schedule: (fn, ms) => window.setTimeout(fn, ms),
      cancel: (id) => window.clearTimeout(id),
    } as Scheduler,
  } = {},
): ProgressThrottle {
  const books = new Map<string, BookState>();

  function fire(bookId: string, state: BookState): void {
    if (state.timer !== null) {
      scheduler.cancel(state.timer);
      state.timer = null;
    }
    if (state.pending === undefined) return;
    const progress = state.pending;
    state.pending = undefined;
    state.lastCommitAt = now();
    state.lastChapterHref = progress?.href ?? null;
    commit(bookId, progress);
  }

  return {
    queue(bookId, progress) {
      let state = books.get(bookId);
      if (!state) {
        state = { pending: undefined, timer: null, lastCommitAt: 0, lastChapterHref: null };
        books.set(bookId, state);
      }
      state.pending = progress;
      // A chapter boundary (or the very first position) is a waypoint worth
      // recording promptly; within a chapter, the interval owns the cadence.
      const boundary =
        state.lastCommitAt === 0 || (progress?.href ?? null) !== state.lastChapterHref;
      const dueIn = boundary
        ? debounceMs
        : Math.max(debounceMs, state.lastCommitAt + commitIntervalMs - now());
      if (state.timer !== null) scheduler.cancel(state.timer);
      state.timer = scheduler.schedule(() => fire(bookId, state), dueIn);
    },
    flushAll() {
      for (const [bookId, state] of books) fire(bookId, state);
    },
    dispose() {
      for (const [bookId, state] of books) fire(bookId, state);
      books.clear();
    },
  };
}
