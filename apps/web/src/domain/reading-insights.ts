import { normalizeReadingInsightsQuery, type ReadingInsights, type ReadingInsightsQuery } from "@read-aware/core";
import { invoke } from "../platform/ipc";
import type { ReadingTimeWire } from "../platform/interim-projections";
import { localDayKey, storeFromWire, type ReadingStatsStore } from "../features/reader/lib/reading-stats";
import { aggregateByHour, computeAchievements, computePeriodInsights, nextTimeMilestone } from "../features/stats/lib/reading-insights";

export function deriveReadingInsights(store: ReadingStatsStore, input: ReadingInsightsQuery = {}, now = Date.now()): ReadingInsights {
  const query = normalizeReadingInsightsQuery(input);
  const asOfDay = query.asOfDay ?? localDayKey(now);
  const clock = new Date(`${asOfDay}T12:00:00`).getTime();
  const scoped = query.bookId ? (store[query.bookId] ? { [query.bookId]: store[query.bookId] } : {}) : store;
  const period = computePeriodInsights(scoped, query.period, clock);
  const achievements = computeAchievements(scoped, clock);
  return { bookId: query.bookId ?? null, source: "settled", asOfDay, period: query.period,
    totalMs: period.totalMs, daysRead: period.daysRead, booksRead: period.booksRead,
    avgPerDayMs: period.avgPerDayMs, deltaRatio: period.deltaPct,
    bars: period.bars.map(({ key, ms, isCurrent }) => ({ key, ms, isCurrent })),
    weekdayMs: period.weekday.map(bucket => bucket.ms), allTimeHourlyMs: aggregateByHour(scoped),
    achievements: { ...achievements, nextMilestoneMs: nextTimeMilestone(achievements.totalMs) } };
}

export async function queryReadingInsights(input: ReadingInsightsQuery = {}): Promise<ReadingInsights> {
  const query = normalizeReadingInsightsQuery(input);
  const wire = await invoke<ReadingTimeWire>("reading_time_scope", { bookId: query.bookId ?? null });
  return deriveReadingInsights(storeFromWire(wire), query);
}
