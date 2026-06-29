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
};

/** Rollup across every book in the store. */
export function computeGlobalInsights(store: ReadingStatsStore, now: number): GlobalInsights {
  const daily = aggregateDaily(store);
  const streak = readingStreak(daily, now);

  let totalMs = 0;
  let booksWithReading = 0;
  for (const stats of Object.values(store)) {
    totalMs += stats.totalMs;
    if (stats.totalMs > 0) booksWithReading += 1;
  }

  return {
    totalMs,
    todayMs: msToday(daily, now),
    weekMs: msInLastDays(daily, now, 7),
    currentStreak: streak.current,
    longestStreak: streak.longest,
    booksWithReading,
    daysRead: distinctDaysRead(daily),
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

export type HeatmapGrid = {
  /** Week columns, each a length-7 array (row 0 = Sunday). */
  columns: HeatmapCell[][];
  /** Month name anchored to the column where the month begins. */
  monthLabels: { col: number; label: string }[];
};

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Minimum trailing span (week columns) so the grid always fills its width. */
const MIN_WEEKS = 53;

/**
 * One continuous GitHub-style contribution grid ending on the current week, so
 * today always sits in the rightmost column. It spans at least the trailing year
 * (`MIN_WEEKS`) — keeping the grid a consistent full width regardless of how
 * little has been read — and extends further back when older reading history
 * exists. Week columns run Sunday→Saturday; the few future days in the current
 * week are marked inactive so the caller renders them as blank spacers.
 */
export function buildHeatmapGrid(daily: DailyReadingMap, now: number): HeatmapGrid {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayKey = localDayKey(today.getTime());

  // Final column ends on the Saturday of the current week.
  const gridEnd = new Date(today);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

  // Baseline trailing window — at least MIN_WEEKS columns, first column a Sunday.
  const gridStart = new Date(gridEnd);
  gridStart.setDate(gridStart.getDate() - (MIN_WEEKS * 7 - 1));

  // Extend leftward (to a Sunday) when reading history predates the window.
  const earliest = earliestReadingDay(daily);
  if (earliest) {
    earliest.setHours(0, 0, 0, 0);
    if (earliest.getTime() < gridStart.getTime()) {
      gridStart.setTime(earliest.getTime());
      gridStart.setDate(gridStart.getDate() - gridStart.getDay()); // back to Sunday
    }
  }

  const columns: HeatmapCell[][] = [];
  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;

  const cursor = new Date(gridStart);
  while (cursor.getTime() <= gridEnd.getTime()) {
    const column: HeatmapCell[] = [];
    for (let row = 0; row < 7; row += 1) {
      const date = new Date(cursor);
      const active = date.getTime() <= today.getTime();
      const key = localDayKey(date.getTime());
      const ms = active ? daily[key] ?? 0 : 0;
      column.push({ key, date, ms, level: heatmapLevel(ms), active, isToday: key === todayKey });
      cursor.setDate(cursor.getDate() + 1);
    }

    const colIndex = columns.length;
    columns.push(column);

    // Anchor a month label at the column where a new month starts (by its Sunday).
    const month = column[0].date.getMonth();
    if (month !== lastMonth) {
      monthLabels.push({ col: colIndex, label: MONTH_SHORT[month] });
      lastMonth = month;
    }
  }

  return { columns, monthLabels };
}

// ── Period scoping ────────────────────────────────────────────────────────────

export type StatsPeriod = "week" | "month" | "year" | "all";

export const STATS_PERIODS: StatsPeriod[] = ["week", "month", "year", "all"];

/** Trailing-window length in days for each fixed period ("all" is unbounded). */
const PERIOD_DAYS: Record<Exclude<StatsPeriod, "all">, number> = {
  week: 7,
  month: 30,
  year: 365,
};

export const PERIOD_TAB_LABELS: Record<StatsPeriod, string> = {
  week: "Week",
  month: "Month",
  year: "Year",
  all: "All",
};

export const PERIOD_RANGE_LABELS: Record<StatsPeriod, string> = {
  week: "Last 7 days",
  month: "Last 30 days",
  year: "Last 12 months",
  all: "All time",
};

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"]; // by Date.getDay() (Sun..Sat)

/** Sum of daily reading over `count` days starting `fromOffset` days ago. */
function sumDailyWindow(
  daily: DailyReadingMap,
  now: number,
  fromOffset: number,
  count: number,
): number {
  let total = 0;
  for (let i = fromOffset; i < fromOffset + count; i += 1) {
    total += daily[dayKeyAtOffset(now, i)] ?? 0;
  }
  return total;
}

/** The set of local-day keys inside the trailing `days`-day window (incl. today). */
function windowDayKeys(now: number, days: number): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i < days; i += 1) keys.add(dayKeyAtOffset(now, i));
  return keys;
}

/** Roll a daily map up into `YYYY-MM` month totals. */
function dailyByMonth(daily: DailyReadingMap): Map<string, number> {
  const months = new Map<string, number>();
  for (const [key, ms] of Object.entries(daily)) {
    const mk = key.slice(0, 7);
    months.set(mk, (months.get(mk) ?? 0) + ms);
  }
  return months;
}

export type StatsBar = {
  /** Stable, unique category id (date / month key) — the chart's x-axis key. */
  key: string;
  /** Friendly axis label; the chart thins these on dense ranges. */
  label: string;
  ms: number;
  /** The bucket containing "now" (today / this month) — rendered emphasized. */
  isCurrent: boolean;
};

/** One bar per day over the trailing `days` days, oldest→newest, ending today. */
function dailyBars(daily: DailyReadingMap, now: number, days: number): StatsBar[] {
  const todayKey = localDayKey(now);
  const dense = days > 10; // months label by day-of-month; weeks by weekday letter
  const bars: StatsBar[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = dayKeyAtOffset(now, i);
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const label = dense ? String(date.getDate()) : WEEKDAY_LETTERS[date.getDay()];
    bars.push({ key, label, ms: daily[key] ?? 0, isCurrent: key === todayKey });
  }
  return bars;
}

/** One bar per calendar month over the trailing `months` months, ending this month. */
function monthlyBars(daily: DailyReadingMap, now: number, months: number): StatsBar[] {
  const byMonth = dailyByMonth(daily);
  const base = new Date(now);
  const curY = base.getFullYear();
  const curM = base.getMonth();
  const bars: StatsBar[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(curY, curM - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const mk = `${y}-${String(m + 1).padStart(2, "0")}`;
    const label = m === 0 ? `${MONTH_SHORT[m]} ’${String(y).slice(2)}` : MONTH_SHORT[m];
    bars.push({ key: mk, label, ms: byMonth.get(mk) ?? 0, isCurrent: i === 0 });
  }
  return bars;
}

/** Whole-month span from the earliest reading month through now (capped). */
function monthsSpan(daily: DailyReadingMap, now: number): number {
  const earliest = earliestReadingDay(daily);
  if (!earliest) return 1;
  const a = new Date(now);
  const span = (a.getFullYear() - earliest.getFullYear()) * 12 + (a.getMonth() - earliest.getMonth()) + 1;
  return Math.min(Math.max(span, 1), 36);
}

export type WeekdayBucket = { label: string; full: string; ms: number };

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun, indexing Date.getDay()
const WEEKDAY_FULL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Reading time summed by weekday (Mon→Sun) over the given daily map. */
export function weekdayDistribution(daily: DailyReadingMap): WeekdayBucket[] {
  const byDow = new Array(7).fill(0);
  for (const [key, ms] of Object.entries(daily)) {
    const [y, m, d] = key.split("-").map(Number);
    byDow[new Date(y, m - 1, d).getDay()] += ms;
  }
  return WEEKDAY_ORDER.map((dow) => ({
    label: WEEKDAY_FULL[dow].slice(0, 1),
    full: WEEKDAY_FULL[dow],
    ms: byDow[dow],
  }));
}

/** All-time reading time by local hour-of-day (length 24), summed across books. */
export function aggregateByHour(store: ReadingStatsStore): number[] {
  const buckets = new Array(24).fill(0);
  for (const stats of Object.values(store)) {
    for (let h = 0; h < 24; h += 1) buckets[h] += stats.byHour[h] ?? 0;
  }
  return buckets;
}

export type PeriodInsights = {
  period: StatsPeriod;
  rangeLabel: string;
  totalMs: number;
  daysRead: number;
  booksRead: number;
  /** Average over active (read) days. */
  avgPerDayMs: number;
  /** Change vs the immediately preceding window of equal length; null if N/A. */
  deltaPct: number | null;
  bars: StatsBar[];
  weekday: WeekdayBucket[];
};

/** Headline rollup for one time period — the body of each period tab. */
export function computePeriodInsights(
  store: ReadingStatsStore,
  period: StatsPeriod,
  now: number,
): PeriodInsights {
  const daily = aggregateDaily(store);

  if (period === "all") {
    const daysRead = distinctDaysRead(daily);
    let totalMs = 0;
    let booksRead = 0;
    for (const stats of Object.values(store)) {
      totalMs += stats.totalMs;
      if (stats.totalMs > 0) booksRead += 1;
    }
    return {
      period,
      rangeLabel: PERIOD_RANGE_LABELS.all,
      totalMs,
      daysRead,
      booksRead,
      avgPerDayMs: daysRead > 0 ? Math.round(totalMs / daysRead) : 0,
      deltaPct: null,
      bars: monthlyBars(daily, now, monthsSpan(daily, now)),
      weekday: weekdayDistribution(daily),
    };
  }

  const days = PERIOD_DAYS[period];
  const keys = windowDayKeys(now, days);
  const totalMs = sumDailyWindow(daily, now, 0, days);
  const prevMs = sumDailyWindow(daily, now, days, days);

  let daysRead = 0;
  for (const key of keys) if ((daily[key] ?? 0) > 0) daysRead += 1;

  let booksRead = 0;
  for (const stats of Object.values(store)) {
    for (const key of Object.keys(stats.daily)) {
      if (keys.has(key) && stats.daily[key] > 0) {
        booksRead += 1;
        break;
      }
    }
  }

  const windowDaily: DailyReadingMap = {};
  for (const key of keys) {
    const ms = daily[key];
    if (ms) windowDaily[key] = ms;
  }

  return {
    period,
    rangeLabel: PERIOD_RANGE_LABELS[period],
    totalMs,
    daysRead,
    booksRead,
    avgPerDayMs: daysRead > 0 ? Math.round(totalMs / daysRead) : 0,
    deltaPct: prevMs > 0 ? (totalMs - prevMs) / prevMs : null,
    bars: period === "year" ? monthlyBars(daily, now, 12) : dailyBars(daily, now, days),
    weekday: weekdayDistribution(windowDaily),
  };
}

/** Per-book reading time and active days within a period window. */
export function bookWindowStats(
  stats: BookReadingStats,
  period: StatsPeriod,
  now: number,
): { ms: number; daysRead: number } {
  if (period === "all") {
    return { ms: stats.totalMs, daysRead: distinctDaysRead(stats.daily) };
  }
  const keys = windowDayKeys(now, PERIOD_DAYS[period]);
  let ms = 0;
  let daysRead = 0;
  for (const key of keys) {
    const dayMs = stats.daily[key] ?? 0;
    if (dayMs > 0) {
      ms += dayMs;
      daysRead += 1;
    }
  }
  return { ms, daysRead };
}

// ── Achievements ──────────────────────────────────────────────────────────────

/** Cumulative-time milestones (ms): 1h, 5h, 10h, 25h, 50h, 100h, 250h, 500h. */
export const TIME_MILESTONES_MS = [1, 5, 10, 25, 50, 100, 250, 500].map((h) => h * 3_600_000);

/** The next unreached cumulative-time milestone, or null once all are passed. */
export function nextTimeMilestone(totalMs: number): number | null {
  return TIME_MILESTONES_MS.find((ms) => ms > totalMs) ?? null;
}

export type AchievementFacts = {
  totalMs: number;
  currentStreak: number;
  longestStreak: number;
  bestDayMs: number;
  bestDayKey: string | null;
  daysRead: number;
  booksRead: number;
  mostReadBookId: string | null;
  mostReadBookMs: number;
};

/** All-time milestone facts for the achievements grid. */
export function computeAchievements(store: ReadingStatsStore, now: number): AchievementFacts {
  const daily = aggregateDaily(store);
  const streak = readingStreak(daily, now);

  let bestDayMs = 0;
  let bestDayKey: string | null = null;
  for (const [key, ms] of Object.entries(daily)) {
    if (ms > bestDayMs) {
      bestDayMs = ms;
      bestDayKey = key;
    }
  }

  let totalMs = 0;
  let booksRead = 0;
  let mostReadBookId: string | null = null;
  let mostReadBookMs = 0;
  for (const stats of Object.values(store)) {
    totalMs += stats.totalMs;
    if (stats.totalMs > 0) booksRead += 1;
    if (stats.totalMs > mostReadBookMs) {
      mostReadBookMs = stats.totalMs;
      mostReadBookId = stats.bookId;
    }
  }

  return {
    totalMs,
    currentStreak: streak.current,
    longestStreak: streak.longest,
    bestDayMs,
    bestDayKey,
    daysRead: distinctDaysRead(daily),
    booksRead,
    mostReadBookId,
    mostReadBookMs,
  };
}
