/**
 * Reading-time accrual: the tracker's crash-safe buffer and its flush.
 *
 * A tick ADDS to a (book, local day, local hour) bucket in the device-local
 * `reading_time_pending` table; the `book.timeRecorded` event is minted only
 * when the bucket closes — the hour rolls over, the book closes, the app goes
 * to the background — and `reading_time_flush` commits the event and retires
 * exactly the milliseconds it carries in ONE transaction. That is what turned
 * the dominant event type from ~12 per reading hour (a five-minute safety
 * flush) into ~1, without a crash ever losing a minute: whatever a crash
 * leaves buffered is flushed at the next boot (`flushPendingReadingTime`,
 * called by the local-store hydration before the stats projection is read).
 *
 * Buckets are keyed by the day/hour the time was READ in, in this device's
 * timezone — the event contract (`book.timeRecorded` in @read-aware/core).
 */
import type { CommitReport } from "./domain-events";
import { broadcastDomainEventDrafts, mintEventRows, type DomainEventDraft } from "./domain-events";
import { isTauri } from "./environment";
import { invoke } from "./ipc";
import { createLogger } from "./logger";

const log = createLogger("reading-time");

/** One open bucket as the store holds it (mirrors `ReadingTimeBucket` in Rust). */
export type ReadingTimeBucket = {
  bookId: string;
  localDay: string;
  localHour: number;
  ms: number;
  startedAt: number;
  lastAt: number;
};

/** Local calendar day key (`YYYY-MM-DD`) for an epoch timestamp. */
export function localDayKey(epochMs: number): string {
  const d = new Date(epochMs);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Local hour-of-day (0–23) for an epoch timestamp. */
export function localHour(epochMs: number): number {
  return new Date(epochMs).getHours();
}

/**
 * Add `deltaMs` of active reading at `atEpochMs` to its bucket. Returns the
 * bucket as it now stands (the tracker closes it when the hour changes).
 * Null outside the desktop shell, where nothing durable exists.
 */
export async function accrueReadingTime(
  bookId: string,
  deltaMs: number,
  atEpochMs: number,
): Promise<ReadingTimeBucket | null> {
  if (!isTauri() || deltaMs <= 0) return null;
  return invoke<ReadingTimeBucket>("reading_time_accrue", {
    bookId,
    localDay: localDayKey(atEpochMs),
    localHour: localHour(atEpochMs),
    deltaMs,
    atEpochMs,
  });
}

/** Every open bucket on this device. */
export async function listPendingReadingTime(): Promise<ReadingTimeBucket[]> {
  if (!isTauri()) return [];
  return invoke<ReadingTimeBucket[]>("reading_time_pending");
}

function draftFor(bucket: ReadingTimeBucket): DomainEventDraft {
  return {
    type: "book.timeRecorded",
    payload: {
      bookId: bucket.bookId,
      ms: bucket.ms,
      atEpochMs: bucket.lastAt,
      localDay: bucket.localDay,
      localHour: bucket.localHour,
    },
  };
}

/**
 * Close buckets: one `book.timeRecorded` event per bucket, committed through
 * the log with the bucket retired in the same transaction. A bucket that
 * accrued more since it was read keeps the remainder (the store subtracts
 * exactly what the event carries), so a tick racing a flush is never lost or
 * counted twice.
 */
export async function flushReadingTimeBuckets(
  buckets: ReadingTimeBucket[],
): Promise<CommitReport> {
  const worth = buckets.filter((b) => b.ms > 0);
  if (!isTauri() || worth.length === 0) return { appended: 0, applied: 0 };
  const drafts = worth.map(draftFor);
  const events = await mintEventRows(drafts);
  const report = await invoke<CommitReport>("reading_time_flush", { events });
  // In-app observers (plugins) see the events the store accepted.
  broadcastDomainEventDrafts(drafts);
  return report;
}

/** Boot recovery: close whatever a previous session left open. */
export async function flushPendingReadingTime(): Promise<number> {
  if (!isTauri()) return 0;
  try {
    const pending = await listPendingReadingTime();
    if (pending.length === 0) return 0;
    const report = await flushReadingTimeBuckets(pending);
    if (report.appended > 0) {
      log.info(`closed ${report.appended} reading-time bucket(s) left open by the previous session`);
    }
    return report.appended;
  } catch (error) {
    // Not fatal for boot: the buckets stay and the next launch (or the next
    // bucket close) flushes them; the stats merely lag until then.
    log.error("could not flush pending reading time", error);
    return 0;
  }
}
