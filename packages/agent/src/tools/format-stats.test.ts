import { describe, expect, test } from "bun:test";
import type { BookStats, Id, StatsOverview } from "@read-aware/core";
import { formatDuration, presentBookStats, presentStatsOverview } from "./format-stats";

describe("formatDuration", () => {
  test("covers the minute-granularity ladder", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(-5)).toBe("0m");
    expect(formatDuration(20_000)).toBe("under 1m");
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(59 * 60_000)).toBe("59m");
    expect(formatDuration(60 * 60_000)).toBe("1h");
    expect(formatDuration(3 * 3_600_000 + 5 * 60_000)).toBe("3h 5m");
  });
});

describe("presentBookStats", () => {
  const stats: BookStats = {
    bookId: "book-1" as Id,
    progressPercent: 42,
    status: "reading",
    locator: "epubcfi(/6/14!/4/2/14)",
    currentLocation: 145,
    totalLocations: 320,
    totalMs: 5_427_000,
    firstReadAt: "2026-07-01T08:00:00Z",
    lastReadAt: "2026-08-09T21:30:00Z",
    daily: {
      "2026-08-09": 2_520_000,
      "2026-08-08": 0,
      "2026-07-01": 2_907_000,
    },
  };

  test("presents durations instead of milliseconds and drops the locator", () => {
    const presented = presentBookStats(stats);
    expect(presented).toEqual({
      bookId: "book-1" as Id,
      status: "reading",
      progressPercent: 42,
      location: "145 of 320",
      totalReadingTime: "1h 30m",
      activeDays: 2,
      firstReadAt: "2026-07-01T08:00:00Z",
      lastReadAt: "2026-08-09T21:30:00Z",
      recentDailyReadingTime: {
        "2026-07-01": "48m",
        "2026-08-09": "42m",
      },
    });
    expect(JSON.stringify(presented)).not.toContain("Ms");
    expect(JSON.stringify(presented)).not.toContain("epubcfi");
  });

  test("keeps only the most recent active days", () => {
    const daily = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [
        `2026-07-${String(i + 1).padStart(2, "0")}`,
        60_000,
      ]),
    );
    const presented = presentBookStats({ ...stats, daily });
    const days = Object.keys(presented.recentDailyReadingTime);
    expect(days).toHaveLength(14);
    expect(days[0]).toBe("2026-07-17");
    expect(days[days.length - 1]).toBe("2026-07-30");
  });
});

describe("presentStatsOverview", () => {
  test("presents the shelf aggregate without raw milliseconds", () => {
    const overview: StatsOverview = {
      totalMs: 7_200_000,
      daily: { "2026-08-09": 3_600_000 },
      firstReadAt: "2026-06-01T00:00:00Z",
      lastReadAt: "2026-08-09T21:30:00Z",
      booksReading: 2,
      booksFinished: 5,
    };
    expect(presentStatsOverview(overview)).toEqual({
      totalReadingTime: "2h",
      activeDays: 1,
      booksReading: 2,
      booksFinished: 5,
      firstReadAt: "2026-06-01T00:00:00Z",
      lastReadAt: "2026-08-09T21:30:00Z",
      recentDailyReadingTime: { "2026-08-09": "1h" },
    });
  });
});
