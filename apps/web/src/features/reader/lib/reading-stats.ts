/**
 * Per-book reading-time stats — interim localStorage seam.
 *
 * This is the storage boundary the rest of the app talks to for "how long has
 * this book been read." Today it is a single JSON blob in localStorage; the
 * local-first target (see docs/data-model.md) is to derive these figures as a
 * projection over the event log. Keeping every caller behind these typed
 * functions means that swap touches only this file — the atom, the tracking
 * hook, and the stats UI stay put.
 *
 * All durations are milliseconds of *active* reading time. Day buckets are keyed
 * by local calendar day so the weekly chart matches the reader's wall clock.
 */

const STORAGE_KEY = "read-aware-reading-stats";

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

function normalizeDaily(value: unknown): DailyReadingMap {
  if (!value || typeof value !== "object") return {};
  const result: DailyReadingMap = {};
  for (const [key, ms] of Object.entries(value as Record<string, unknown>)) {
    if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) result[key] = ms;
  }
  return result;
}

/** Coerce stored hour data into a clean length-24 histogram (back-compat: absent → zeros). */
function normalizeHourly(value: unknown): HourlyReadingBuckets {
  const buckets = emptyHourBuckets();
  if (!Array.isArray(value)) return buckets;
  for (let h = 0; h < 24; h += 1) {
    const ms = value[h];
    if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) buckets[h] = ms;
  }
  return buckets;
}

export function getReadingStatsStore(): ReadingStatsStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};

    const result: ReadingStatsStore = {};
    for (const [bookId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const v = value as Partial<BookReadingStats>;
      result[bookId] = {
        bookId,
        firstStartedAt: typeof v.firstStartedAt === "number" ? v.firstStartedAt : null,
        lastReadAt: typeof v.lastReadAt === "number" ? v.lastReadAt : null,
        totalMs: typeof v.totalMs === "number" && v.totalMs >= 0 ? v.totalMs : 0,
        daily: normalizeDaily(v.daily),
        byHour: normalizeHourly(v.byHour),
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function saveReadingStatsStore(store: ReadingStatsStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
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

/** Compact human duration: `<1m`, `42m`, `3h`, `3h 20m`. */
export function formatReadingDuration(ms: number): string {
  if (!(ms > 0)) return "0m";
  if (ms < 60_000) return "<1m";
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
