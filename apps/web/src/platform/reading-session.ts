/**
 * Reading sessions: the tracker's crash-safe scratch pad and its flush.
 *
 * Reading is modelled as SESSIONS, not as ticks and page turns. A tick ADDS
 * active time to a (book, local day, local hour) bucket in the device-local
 * `reading_sessions_pending` table and every page turn OVERWRITES the
 * bucket's position; the single `book.sessionRecorded` event for the bucket —
 * the time read plus the position last observed — is minted
 * only when the bucket CLOSES: the hour rolls over, the book or the app
 * closes, reading pauses. `reading_session_flush` commits the event and
 * retires the bucket in ONE transaction, so a tick or page turn racing a
 * flush is never lost or counted twice. A crash loses nothing: whatever is
 * still open is closed at the next boot (`flushPendingReadingSessions`,
 * called by the local-store hydration before the projections are read).
 *
 * Buckets are keyed by the day/hour the time was READ in, in this device's
 * timezone — the event contract (`book.sessionRecorded` in @read-aware/core).
 */
import { errorCode, type ReadingModeResume, type ReadingStatus } from "@read-aware/core";
import type { CommitReport } from "./domain-events";
import {
  broadcastDomainEventDrafts,
  mintEventRows,
  mintEventRowsAfterCurrentFrontier,
  type DomainEventDraft,
} from "./domain-events";
import { isTauri } from "./environment";
import { invoke } from "./ipc";
import { createLogger } from "./logger";
import { durableWrites } from "./write-settlement";

const log = createLogger("reading-session");

/** The position a session carries — the reader's progress in event shape. */
export type SessionPosition = {
  /** When the position was observed; filled in by the flush from the bucket. */
  observedAt?: number;
  locator: string;
  chapterHref?: string;
  currentLocation?: number;
  totalLocations?: number;
  progressPercent?: number;
  status?: ReadingStatus;
  /** The reading mode's resting unit at this observation (see `book.sessionRecorded`). */
  readingMode?: ReadingModeResume | null;
};

/** One open bucket as the store holds it (mirrors `ReadingSessionBucket`). */
export type ReadingSessionBucket = {
  bookId: string;
  localDay: string;
  localHour: number;
  ms: number;
  startedAt: number;
  lastAt: number;
  /** The latest position seen, or null when only time accrued. */
  progress: SessionPosition | null;
  /** When that position was observed (page turns only, never ticks); the
   * clock the projection's last-observed rule compares. */
  positionAt: number | null;
};

/** Local calendar day key (`YYYY-MM-DD`) for an epoch timestamp. */
export function localDayKey(epochMs: number): string {
  const d = new Date(epochMs);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${String(d.getFullYear()).padStart(4, "0")}-${month}-${day}`;
}

/** Local hour-of-day (0–23) for an epoch timestamp. */
export function localHour(epochMs: number): number {
  return new Date(epochMs).getHours();
}

/**
 * Add `deltaMs` of active reading at `atEpochMs` to its bucket. Returns the
 * bucket as it now stands. Null outside the desktop shell, where nothing
 * durable exists.
 */
export async function accrueReadingSession(
  bookId: string,
  deltaMs: number,
  atEpochMs: number,
): Promise<ReadingSessionBucket | null> {
  if (!isTauri() || deltaMs <= 0) return null;
  return invoke<ReadingSessionBucket>("reading_session_accrue", {
    bookId,
    localDay: localDayKey(atEpochMs),
    localHour: localHour(atEpochMs),
    deltaMs,
    atEpochMs,
  });
}

/**
 * A page turn: the bucket's position becomes `progress`, observed at
 * `atEpochMs` — turning back counts like any other turn. Creates the bucket
 * (with no time yet) when the first tick has not fired. Null outside the
 * desktop shell.
 */
export async function noteReadingPosition(
  bookId: string,
  progress: SessionPosition,
  atEpochMs: number,
): Promise<ReadingSessionBucket | null> {
  if (!isTauri()) return null;
  return invoke<ReadingSessionBucket>("reading_session_position", {
    bookId,
    localDay: localDayKey(atEpochMs),
    localHour: localHour(atEpochMs),
    atEpochMs,
    progress,
  });
}

/** Every open bucket on this device. */
export async function listPendingReadingSessions(): Promise<ReadingSessionBucket[]> {
  if (!isTauri()) return [];
  return invoke<ReadingSessionBucket[]>("reading_sessions_pending");
}

function draftFor(bucket: ReadingSessionBucket): DomainEventDraft {
  return {
    type: "book.sessionRecorded",
    payload: {
      bookId: bucket.bookId,
      ms: bucket.ms,
      startedAt: bucket.startedAt,
      endedAt: bucket.lastAt,
      localDay: bucket.localDay,
      localHour: bucket.localHour,
      ...(bucket.progress ? { progress: { ...bucket.progress, observedAt: bucket.positionAt ?? bucket.lastAt } } : {}),
    },
  };
}

/**
 * Close buckets: one `book.sessionRecorded` event per bucket, committed
 * through the log with the bucket retired in the same transaction. Time
 * accrued or a position observed after the bucket was read stays open for
 * the next close.
 */
export async function flushReadingSessions(buckets: ReadingSessionBucket[]): Promise<CommitReport> {
  const worth = buckets.filter((b) => b.ms > 0 || b.progress !== null);
  if (!isTauri() || worth.length === 0) return { appended: 0, applied: 0 };
  return durableWrites.run(async () => {
    const drafts = worth.map(draftFor);
    const events = await mintEventRows(drafts);
    const report = await invoke<CommitReport>("reading_session_flush", { events });
    // In-app observers (plugins) see the events the store accepted.
    broadcastDomainEventDrafts(drafts);
    return report;
  });
}

/** Boot recovery: close whatever a previous session left open. */
export async function flushPendingReadingSessions(): Promise<number> {
  if (!isTauri()) return 0;
  try {
    const pending = await listPendingReadingSessions();
    if (pending.length === 0) return 0;
    const report = await flushReadingSessions(pending);
    if (report.appended > 0) {
      log.info(`closed ${report.appended} reading session(s) left open by the previous run`);
    }
    return report.appended;
  } catch (error) {
    // Not fatal for boot: the buckets stay and the next launch (or the next
    // close) flushes them; the stats and position merely lag until then.
    log.error("could not flush pending reading sessions", error);
    return 0;
  }
}

/** Full backup's host preparation. Caller pauses/drains reader writes until
 * capture/planning ends; native capture also refuses any newly opened bucket. */
export async function closeReadingSessionsForBackup(): Promise<number> {
  if (!isTauri()) return 0;
  return durableWrites.run(async () => {
    for (let attempt = 0; ; attempt++) {
      const buckets = await listPendingReadingSessions();
      if (buckets.length === 0) return 0;
      const drafts: DomainEventDraft[] = buckets
        .filter((b) => b.ms > 0 || b.progress !== null)
        .map((bucket) => ({ ...draftFor(bucket), origin: "system" }));
      const events = await mintEventRowsAfterCurrentFrontier(drafts);
      try {
        const closed = await invoke<DomainEventDraft[]>("backup_close_reading_sessions", { events });
        broadcastDomainEventDrafts(closed);
        return closed.length;
      } catch (error) {
        if (errorCode(error) === "backup/changed" && attempt < 2) continue;
        throw error; // Strict backup preparation never swallows a failed close.
      }
    }
  });
}
