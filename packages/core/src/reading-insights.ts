import { AppError } from "./errors";
import { normalizeReadingTimeQuery } from "./reading-time";

export type ReadingPeriod = "week" | "month" | "year" | "all";
export type ReadingInsightsQuery = { bookId?: string; period?: ReadingPeriod; asOfDay?: string };
export type ReadingInsights = {
  bookId: string | null;
  source: "settled";
  asOfDay: string;
  period: ReadingPeriod;
  totalMs: number;
  daysRead: number;
  booksRead: number;
  avgPerDayMs: number;
  /** Ratio, not a percentage: 0.5 means +50%. Null when comparison is undefined. */
  deltaRatio: number | null;
  /** Days for week/month; months for year/all. Keys, not localized labels. */
  bars: { key: string; ms: number; isCurrent: boolean }[];
  /** Seven slots, Monday first. */
  weekdayMs: number[];
  /** Host only stores the all-time hour histogram; never pretend it is period-scoped. */
  allTimeHourlyMs: number[];
  achievements: {
    totalMs: number; currentStreak: number; longestStreak: number;
    bestDayMs: number; bestDayKey: string | null; daysRead: number; booksRead: number;
    mostReadBookId: string | null; mostReadBookMs: number; nextMilestoneMs: number | null;
  };
};

export function normalizeReadingInsightsQuery(query: ReadingInsightsQuery = {}): ReadingInsightsQuery & { period: ReadingPeriod } {
  if (!query || typeof query !== "object" || Array.isArray(query)) throw new AppError("reading/invalid-time-query", "Invalid insights query");
  const scope = normalizeReadingTimeQuery({ bookId: query.bookId, localDay: query.asOfDay });
  const period = query.period ?? "week";
  if (!["week", "month", "year", "all"].includes(period)
    || (query.asOfDay !== undefined && Number(query.asOfDay.slice(0, 4)) < 100)) {
    throw new AppError("reading/invalid-time-query", "Invalid insights period or reference day");
  }
  return { ...(scope.bookId !== undefined ? { bookId: scope.bookId } : {}), period,
    ...(query.asOfDay !== undefined ? { asOfDay: query.asOfDay } : {}) };
}
