/**
 * Per-book reading-time stats.
 *
 * This is the storage boundary the rest of the app talks to for "how long has
 * this book been read." The projection is the SQLite `reading_time_totals` /
 * `reading_time_daily` / `reading_time_hourly` tables (migration v9); the
 * `reading.timeRecorded` events already dual-write in the tracker. Boot reads
 * the tables into the platform snapshot (interim-projections); after boot the
 * live figures accumulate in the readingStatsAtom, and each tracker tick
 * write-throughs its delta with `recordReadingTime`. The browser shell keeps
 * no durable stats (pure UI shell).
 *
 * All durations are milliseconds of *active* reading time. Day buckets are keyed
 * by local calendar day so the weekly chart matches the reader's wall clock.
 */

import { isTauri } from "../../../platform/environment";
import {
  getReadingTimeSnapshot,
  importReadingTime,
  loadReadingTime,
  recordReadingTimeDelta,
  type ReadingTimeWire,
} from "../../../platform/interim-projections";

/** Milliseconds of reading keyed by local day, e.g. `{ "2026-06-25": 840000 }`. */
export type DailyReadingMap = Record<string, number>;

/** Reading time (ms) bucketed by local hour-of-day, a fixed 24-slot histogram. */
export type HourlyReadingBuckets = number[];

export type BookReadingStats = {
  bookId: string;
  /** Epoch ms when reading time was first recorded for this book. */
  firstStartedAt: number | null;
  /** Epoch ms of the most recent recorded reading activity. */
  lastReadAt: number | null;
  /** Cumulative active reading time, in ms. */
  totalMs: number;
  daily: DailyReadingMap;
  /** All-time reading time by local hour-of-day (length 24, index 0 = midnight). */
  byHour: HourlyReadingBuckets;
};

/** All books' stats, keyed by library book id. */
export type ReadingStatsStore = Record<string, BookReadingStats>;

/** A fresh 24-slot hour histogram, all zero. */
export function emptyHourBuckets(): HourlyReadingBuckets {
  return new Array(24).fill(0);
}

export function emptyBookStats(bookId: string): BookReadingStats {
  return {
    bookId,
    firstStartedAt: null,
    lastReadAt: null,
    totalMs: 0,
    daily: {},
    byHour: emptyHourBuckets(),
  };
}

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

/** Assemble the typed store from the three-table wire shape. */
export function storeFromWire(wire: ReadingTimeWire): ReadingStatsStore {
  const result: ReadingStatsStore = {};
  const of = (bookId: string): BookReadingStats =>
    (result[bookId] ??= emptyBookStats(bookId));
  for (const row of wire.totals) {
    const stats = of(row.bookId);
    stats.totalMs = row.totalMs;
    stats.firstStartedAt = row.firstStartedAt ?? null;
    stats.lastReadAt = row.lastReadAt ?? null;
  }
  for (const row of wire.daily) of(row.bookId).daily[row.localDay] = row.ms;
  for (const row of wire.hourly) {
    if (row.localHour >= 0 && row.localHour < 24) of(row.bookId).byHour[row.localHour] = row.ms;
  }
  return result;
}

/** Boot snapshot of the SQLite projection (empty in the browser shell). */
export function getReadingStatsStore(): ReadingStatsStore {
  if (!isTauri()) return {};
  return storeFromWire(getReadingTimeSnapshot());
}

/** Fresh async read of the SQLite projection (the reading domain's `getTime`). */
export async function loadReadingStatsStore(): Promise<ReadingStatsStore> {
  return storeFromWire(await loadReadingTime());
}

/** Write-through one tracker tick (the event dual-write stays in the tracker). */
export function recordReadingTime(bookId: string, ms: number, atEpochMs: number): void {
  if (!isTauri()) return;
  recordReadingTimeDelta(bookId, ms, atEpochMs, localDayKey(atEpochMs), localHour(atEpochMs));
}

/** Bulk replace (the stats demo seed). */
export function replaceReadingStatsStore(store: ReadingStatsStore): void {
  if (!isTauri()) return;
  const books = Object.values(store);
  importReadingTime({
    totals: books.map((book) => ({
      bookId: book.bookId,
      totalMs: book.totalMs,
      firstStartedAt: book.firstStartedAt,
      lastReadAt: book.lastReadAt,
    })),
    daily: books.flatMap((book) =>
      Object.entries(book.daily).map(([localDay, ms]) => ({
        bookId: book.bookId,
        localDay,
        ms,
      })),
    ),
    hourly: books.flatMap((book) =>
      book.byHour.flatMap((ms, localHour) =>
        ms > 0 ? [{ bookId: book.bookId, localHour, ms }] : [],
      ),
    ),
  });
}

export function getBookReadingStats(
  store: ReadingStatsStore,
  bookId: string,
): BookReadingStats {
  return store[bookId] ?? emptyBookStats(bookId);
}

/**
 * Add a chunk of active reading time to a book. Pure: returns a new store with
 * the book's total and today's bucket incremented and timestamps advanced. A
 * non-positive `ms` is ignored.
 */
export function addReadingTime(
  store: ReadingStatsStore,
  bookId: string,
  ms: number,
  now: number,
): ReadingStatsStore {
  if (!(ms > 0)) return store;
  const prev = store[bookId] ?? emptyBookStats(bookId);
  const dayKey = localDayKey(now);
  const hour = localHour(now);
  const byHour = prev.byHour.slice();
  byHour[hour] += ms;
  return {
    ...store,
    [bookId]: {
      bookId,
      firstStartedAt: prev.firstStartedAt ?? now,
      lastReadAt: now,
      totalMs: prev.totalMs + ms,
      daily: { ...prev.daily, [dayKey]: (prev.daily[dayKey] ?? 0) + ms },
      byHour,
    },
  };
}

export type ReadingDayBucket = {
  key: string;
  date: Date;
  ms: number;
  isToday: boolean;
};

/**
 * The last `days` calendar days (oldest first, ending today) with each day's
 * recorded reading time — the series the weekly distribution chart renders.
 */
export function weeklyReadingBuckets(
  stats: BookReadingStats,
  now: number,
  days = 7,
): ReadingDayBucket[] {
  const todayKey = localDayKey(now);
  const buckets: ReadingDayBucket[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - i);
    const key = localDayKey(date.getTime());
    buckets.push({ key, date, ms: stats.daily[key] ?? 0, isToday: key === todayKey });
  }
  return buckets;
}

/**
 * Compact human duration: `<1m`, `42m`, `3h`, `3h 20m`.
 *
 * Delegates to the locale-aware formatter so unit abbreviations follow the app
 * language. Kept as a re-export here so the many existing call sites (reader,
 * stats, charts) localize with no change.
 */
export { formatDuration as formatReadingDuration } from "../../../i18n/format";
