import { expect, test } from "bun:test";
import { normalizeReadingInsightsQuery, READING_DOMAIN_EVENT_TYPES } from "@read-aware/core";
import type { ReadingDomainEventType, PluginDomainEvent } from "@read-aware/plugin-types";
import { READING_EVENTS, domainSubscribe } from "./events";
import { broadcastDomainEventDrafts } from "../platform/domain-events";
import { emptyBookStats } from "../features/reader/lib/reading-stats";
import { deriveReadingInsights } from "./reading-insights";
import { initI18n } from "../i18n";

test("insights reuse UI windows and keep all-time hours/milestones separate", async () => {
  await initI18n("en");
  const a = { ...emptyBookStats("a"), totalMs: 100_000, daily: { "2026-09-09": 20_000, "2026-09-08": 10_000, "2026-09-02": 70_000 } };
  a.byHour[18] = 100_000;
  const b = { ...emptyBookStats("b"), totalMs: 50_000, daily: { "2026-09-08": 50_000 } };
  const week = deriveReadingInsights({ a, b }, { bookId: "a", period: "week", asOfDay: "2026-09-09" });
  expect(week.totalMs).toBe(30_000); expect(week.bars).toHaveLength(7);
  expect(week.booksRead).toBe(1); expect(week.daysRead).toBe(2);
  expect(week.deltaRatio).toBeCloseTo(-4 / 7);
  expect(week.weekdayMs.reduce((a, b) => a + b, 0)).toBe(week.totalMs);
  expect(week.allTimeHourlyMs[18]).toBe(100_000);
  expect(week.achievements).toMatchObject({ totalMs: 100_000, currentStreak: 2, longestStreak: 2, bestDayKey: "2026-09-02", nextMilestoneMs: 3_600_000 });
  const all = deriveReadingInsights({ a, b }, { period: "all", asOfDay: "2026-09-09" });
  expect(all.totalMs).toBe(150_000); expect(all.booksRead).toBe(2); expect(all.deltaRatio).toBeNull();
});

test("365-day chart includes both partial boundary months but no outside days", () => {
  const a = { ...emptyBookStats("a"), totalMs: 66, daily: { "2025-09-09": 1, "2025-09-10": 2, "2026-09-09": 4, "2026-09-10": 8, "2024-09-09": 51 } };
  const year = deriveReadingInsights({ a }, { period: "year", asOfDay: "2026-09-09" });
  expect(year.totalMs).toBe(6); expect(year.bars).toHaveLength(13);
  expect(year.bars[0]).toMatchObject({ key: "2025-09", ms: 2 });
  expect(year.bars.at(-1)).toMatchObject({ key: "2026-09", ms: 4 });
  expect(year.bars.reduce((n, bar) => n + bar.ms, 0)).toBe(year.totalMs);
  for (const query of [{ period: "bad" }, { asOfDay: "2026-02-30" }, { asOfDay: "0099-01-01" }, { bookId: " " }, null]) {
    expect(() => normalizeReadingInsightsQuery(query as never)).toThrow();
  }
});

test("canonical session event has one runtime/SDK roster and typed payload, delivery and disposal", () => {
  const name: ReadingDomainEventType = "book.sessionRecorded";
  const event: PluginDomainEvent<typeof name> = { type: name, createdAt: "2026-09-09T00:00:00Z", origin: "user", payload: {
    bookId: "b", ms: 1234, startedAt: 1000, endedAt: 2000, localDay: "2026-09-09", localHour: 8 } };
  expect(READING_EVENTS).toBe(READING_DOMAIN_EVENT_TYPES);
  const seen: unknown[] = [];
  const stop = domainSubscribe(READING_EVENTS, "test")(name, value => seen.push(value.payload));
  broadcastDomainEventDrafts([{ type: name, payload: event.payload }]);
  expect(seen).toEqual([event.payload]); stop();
  broadcastDomainEventDrafts([{ type: name, payload: event.payload }]); expect(seen).toHaveLength(1);
});

test("accepted early reference years preserve padded calendar keys across year boundaries", () => {
  const a = { ...emptyBookStats("a"), totalMs: 3, daily: { "0099-12-31": 1, "0100-01-01": 2 } };
  const week = deriveReadingInsights({ a }, { period: "week", asOfDay: "0100-01-01" });
  expect(week.totalMs).toBe(3);
  expect(week.bars.at(-2)?.key).toBe("0099-12-31");
  expect(week.bars.at(-1)?.key).toBe("0100-01-01");
  expect(week.achievements).toMatchObject({ currentStreak: 2, longestStreak: 2 });
  expect(week.weekdayMs.reduce((sum, ms) => sum + ms, 0)).toBe(3);
  const year = deriveReadingInsights({ a }, { period: "year", asOfDay: "0100-01-01" });
  expect(year.bars.at(-2)).toMatchObject({ key: "0099-12", ms: 1 });
  expect(year.bars.at(-1)).toMatchObject({ key: "0100-01", ms: 2 });
  expect(year.bars.reduce((sum, bar) => sum + bar.ms, 0)).toBe(3);
});

test("opening the product statistics surface cannot seed synthetic durable history", async () => {
  const source = await Bun.file(new URL("../features/stats/components/StatsWorkspace.tsx", import.meta.url)).text();
  expect(source).not.toMatch(/seedReadingStats|replaceReadingStatsStore|willAutoSeed/);
});
