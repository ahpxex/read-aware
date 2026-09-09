import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { normalizeReadingInsightsQuery, type ReadingInsightsQuery } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { normalizeBookIdParam } from "./current-book";
import { textResult } from "./tool-result";

export function buildReadingInsightsTool(scope: ThreadScope, deps: RuntimeDeps): AgentTool {
  return { name: "get_reading_insights", label: "Reading trends",
    description: "Get settled reading trends, streaks and milestones for week (trailing 7 days), month (30), year (365), or all time. Includes bounded date/month bars and period weekday totals (Monday first). Hour-of-day distribution and achievements are ALWAYS all-time, even for a selected period. Never describe these hours as period-specific. asOfDay is a calendar reference for windows and current streak, not a historical database snapshot. Day/hour labels remain those recorded on each device. All-time bars show at most 36 recent calendar months, so may not sum to lifetime total. Aggregate history includes removed books whose reading records remain. Use get_reading_time for provisional time. Defaults to current book in book scope; allBooks=true explicitly aggregates.",
    parameters: Type.Object({ bookId: Type.Optional(Type.String()), allBooks: Type.Optional(Type.Boolean()),
      period: Type.Optional(Type.Union([Type.Literal("week"), Type.Literal("month"), Type.Literal("year"), Type.Literal("all")])),
      asOfDay: Type.Optional(Type.String()) }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const input = params as ReadingInsightsQuery & { allBooks?: boolean };
      const bookId = input.allBooks ? undefined : normalizeBookIdParam(input.bookId) ?? (scope.kind === "book" ? String(scope.bookId) : undefined);
      const report = await deps.library.getReadingInsights(normalizeReadingInsightsQuery({ ...input, bookId }));
      signal?.throwIfAborted();
      const a = report.achievements;
      return textResult({ bookId: report.bookId, source: report.source, asOfDay: report.asOfDay, period: report.period,
        readingSeconds: report.totalMs / 1000, activeDays: report.daysRead, booksRead: report.booksRead,
        averageActiveDaySeconds: report.avgPerDayMs / 1000, changeRatio: report.deltaRatio,
        bars: report.bars.map(({ key, ms }) => ({ key, readingSeconds: ms / 1000 })),
        weekdaySecondsMondayFirst: report.weekdayMs.map(ms => ms / 1000),
        allTimeHourlySeconds: report.allTimeHourlyMs.map(ms => ms / 1000),
        allTimeAchievements: { readingSeconds: a.totalMs / 1000, activeDays: a.daysRead, booksRead: a.booksRead,
          currentStreak: a.currentStreak, longestStreak: a.longestStreak, bestDay: a.bestDayKey,
          bestDaySeconds: a.bestDayMs / 1000, mostReadBookId: a.mostReadBookId, mostReadBookSeconds: a.mostReadBookMs / 1000,
          nextMilestoneSeconds: a.nextMilestoneMs === null ? null : a.nextMilestoneMs / 1000 } });
    } };
}
