/**
 * Reading insights — pure derivations over the reading-stats store.
 *
 * The raw store (per-book `totalMs` + a `daily` map of local-day → ms) lives in
 * `reader/lib/reading-stats`. This module derives the richer figures the stats
 * surfaces need — time dimensions, streaks, per-book and global rollups, and the
 * calendar-heatmap grid — without owning any storage or React state. Everything
 * here is a pure function of `(store|daily, now)`, so it is trivially testable
 * and reused by the book Info panel and the header overview alike.
 *
 * All day math is local-calendar based, matching `localDayKey`, so figures line
 * up with the reader's wall clock and never drift across time zones.
 */

import {
  localDayKey,
  type BookReadingStats,
  type DailyReadingMap,
  type ReadingStatsStore,
} from "../../reader/lib/reading-stats";

/** Midnight-to-midnight day index of a `YYYY-MM-DD` key, DST-proof. */
function dayIndexFromKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** The local-day key `offset` days before `now` (offset 0 = today). */
function dayKeyAtOffset(now: number, offset: number): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offset);
  return localDayKey(d.getTime());
}

/** Merge every book's daily map into one combined local-day → ms map. */
export function aggregateDaily(store: ReadingStatsStore): DailyReadingMap {
  const merged: DailyReadingMap = {};
  for (const stats of Object.values(store)) {
    for (const [day, ms] of Object.entries(stats.daily)) {
      merged[day] = (merged[day] ?? 0) + ms;
    }
  }
  return merged;
}

/** Reading time recorded today. */
export function msToday(daily: DailyReadingMap, now: number): number {
  return daily[localDayKey(now)] ?? 0;
}

/** Reading time over the last `days` calendar days, inclusive of today. */
export function msInLastDays(daily: DailyReadingMap, now: number, days: number): number {
  let total = 0;
  for (let i = 0; i < days; i += 1) {
    total += daily[dayKeyAtOffset(now, i)] ?? 0;
  }
  return total;
}

/** Count of distinct calendar days with any recorded reading. */
export function distinctDaysRead(daily: DailyReadingMap): number {
  let count = 0;
  for (const ms of Object.values(daily)) {
    if (ms > 0) count += 1;
  }
  return count;
}

/**
 * Current and longest run of consecutive days with reading. The current streak
 * counts back from today; a day with no reading *yet today* doesn't break it
 * (it resumes from yesterday), so an active streak survives until a full empty
 * day passes.
 */
export function readingStreak(
  daily: DailyReadingMap,
  now: number,
): { current: number; longest: number } {
  let current = 0;
  const startOffset = (daily[localDayKey(now)] ?? 0) > 0 ? 0 : 1;
  for (let i = startOffset; ; i += 1) {
    if ((daily[dayKeyAtOffset(now, i)] ?? 0) > 0) current += 1;
    else break;
  }

  const indices = Object.keys(daily)
    .filter((key) => (daily[key] ?? 0) > 0)
    .map(dayIndexFromKey)
    .sort((a, b) => a - b);

  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const idx of indices) {
    run = prev !== null && idx - prev === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = idx;
  }

  return { current, longest };
}

/** Earliest local day with any recorded reading (heatmap start), or `null`. */
export function earliestReadingDay(daily: DailyReadingMap): Date | null {
  let min: string | null = null;
  for (const [key, ms] of Object.entries(daily)) {
    if (!(ms > 0)) continue;
    // ISO `YYYY-MM-DD` keys sort lexically the same as chronologically.
    if (min === null || key < min) min = key;
  }
  if (min === null) return null;
  const [y, m, d] = min.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export type BookInsights = {
  totalMs: number;
  todayMs: number;
  weekMs: number;
  monthMs: number;
  daysRead: number;
  currentStreak: number;
  longestStreak: number;
  avgPerActiveDayMs: number;
  firstStartedAt: number | null;
  lastReadAt: number | null;
};

/** Full rollup of one book's reading figures. */
export function computeBookInsights(stats: BookReadingStats, now: number): BookInsights {
  const { daily } = stats;
  const daysRead = distinctDaysRead(daily);
  const streak = readingStreak(daily, now);
  return {
    totalMs: stats.totalMs,
    todayMs: msToday(daily, now),
    weekMs: msInLastDays(daily, now, 7),
    monthMs: msInLastDays(daily, now, 30),
    daysRead,
    currentStreak: streak.current,
    longestStreak: streak.longest,
    avgPerActiveDayMs: daysRead > 0 ? Math.round(stats.totalMs / daysRead) : 0,
    firstStartedAt: stats.firstStartedAt,
    lastReadAt: stats.lastReadAt,
  };
}

export type GlobalInsights = {
  totalMs: number;
  todayMs: number;
  weekMs: number;
  currentStreak: number;
  longestStreak: number;
  booksWithReading: number;
  daysRead: number;
  /** Book id with the most recent reading activity, for "continue reading". */
  mostRecentBookId: string | null;
};

/** Rollup across every book in the store. */
export function computeGlobalInsights(store: ReadingStatsStore, now: number): GlobalInsights {
  const daily = aggregateDaily(store);
  const streak = readingStreak(daily, now);

  let totalMs = 0;
  let booksWithReading = 0;
  let mostRecentBookId: string | null = null;
  let mostRecentAt = -Infinity;
  for (const stats of Object.values(store)) {
    totalMs += stats.totalMs;
    if (stats.totalMs > 0) booksWithReading += 1;
    if (stats.lastReadAt !== null && stats.lastReadAt > mostRecentAt) {
      mostRecentAt = stats.lastReadAt;
      mostRecentBookId = stats.bookId;
    }
  }

  return {
    totalMs,
    todayMs: msToday(daily, now),
    weekMs: msInLastDays(daily, now, 7),
    currentStreak: streak.current,
    longestStreak: streak.longest,
    booksWithReading,
    daysRead: distinctDaysRead(daily),
    mostRecentBookId,
  };
}

/** Upper bounds (ms) for heatmap intensity levels 1–3; anything above is level 4. */
export const HEATMAP_THRESHOLDS_MS = [15 * 60_000, 45 * 60_000, 90 * 60_000] as const;

export type HeatmapLevel = 0 | 1 | 2 | 3 | 4;

/** Bucket a day's reading time into an intensity level (0 = none). */
export function heatmapLevel(ms: number): HeatmapLevel {
  if (!(ms > 0)) return 0;
  if (ms < HEATMAP_THRESHOLDS_MS[0]) return 1;
  if (ms < HEATMAP_THRESHOLDS_MS[1]) return 2;
  if (ms < HEATMAP_THRESHOLDS_MS[2]) return 3;
  return 4;
}

export type HeatmapCell = {
  key: string;
  date: Date;
  ms: number;
  level: HeatmapLevel;
  /** False for padding days outside the year or in the future — rendered blank. */
  active: boolean;
  isToday: boolean;
};

export type HeatmapYear = {
  year: number;
  /** Week columns, each a length-7 array (row 0 = Sunday). */
  columns: HeatmapCell[][];
  /** Month name anchored to the column where the month begins. */
  monthLabels: { col: number; label: string }[];
};

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * A GitHub-style contribution grid per calendar year, newest year first, from
 * the first recorded reading day through today. Each year spans the Sunday on or
 * before Jan 1 to the Saturday on or after its end (today for the current year);
 * days outside the year or in the future are marked inactive so the caller can
 * render them as blank spacers that keep week columns aligned.
 */
export function buildHeatmapYears(daily: DailyReadingMap, now: number): HeatmapYear[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayKey = localDayKey(today.getTime());

  const start = earliestReadingDay(daily) ?? new Date(today);
  start.setHours(0, 0, 0, 0);

  const startYear = start.getFullYear();
  const endYear = today.getFullYear();

  const years: HeatmapYear[] = [];
  for (let year = endYear; year >= startYear; year -= 1) {
    const yearEnd = year === endYear ? new Date(today) : new Date(year, 11, 31);
    const gridStart = new Date(year, 0, 1);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay()); // back to Sunday
    const gridEnd = new Date(yearEnd);
    gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay())); // forward to Saturday

    const columns: HeatmapCell[][] = [];
    const monthLabels: { col: number; label: string }[] = [];
    let lastMonth = -1;

    const cursor = new Date(gridStart);
    while (cursor.getTime() <= gridEnd.getTime()) {
      const column: HeatmapCell[] = [];
      for (let row = 0; row < 7; row += 1) {
        const date = new Date(cursor);
        const inYear = date.getFullYear() === year;
        const active = inYear && date.getTime() <= today.getTime();
        const key = localDayKey(date.getTime());
        const ms = active ? daily[key] ?? 0 : 0;
        column.push({ key, date, ms, level: heatmapLevel(ms), active, isToday: key === todayKey });
        cursor.setDate(cursor.getDate() + 1);
      }

      const colIndex = columns.length;
      columns.push(column);

      const rep = column.find((cell) => cell.date.getFullYear() === year);
      if (rep) {
        const month = rep.date.getMonth();
        if (month !== lastMonth) {
          monthLabels.push({ col: colIndex, label: MONTH_SHORT[month] });
          lastMonth = month;
        }
      }
    }

    years.push({ year, columns, monthLabels });
  }

  return years;
}
