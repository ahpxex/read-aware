import { expect, test } from "bun:test";
import type { PluginContext, PluginDetailView, PluginFormView, PluginView, ReadingInsights } from "@read-aware/plugin-types";
import { readingInsightsForm, readingInsightsView } from "../src/insights-view";
import { insightsCopy } from "../src/insights-strings";

const sample: ReadingInsights = { bookId: "b", source: "settled", asOfDay: "2026-09-09", period: "week", totalMs: 1000,
  daysRead: 1, booksRead: 1, avgPerDayMs: 1000, deltaRatio: null, bars: [{ key: "2026-09-09", ms: 1000, isCurrent: true }],
  weekdayMs: [0, 0, 1000, 0, 0, 0, 0], allTimeHourlyMs: Array(24).fill(0), achievements: { totalMs: 1000, currentStreak: 1,
    longestStreak: 1, bestDayMs: 1000, bestDayKey: "2026-09-09", daysRead: 1, booksRead: 1, mostReadBookId: "b", mostReadBookMs: 1000, nextMilestoneMs: 3_600_000 } };
const tick = async () => { for (let i = 0; i < 20; ++i) await Promise.resolve(); };

test("trend view consumes canonical settlement events, coalesces refresh and discards late publication", async () => {
  const handlers = new Map<string, (event: { payload: { bookId: string } }) => void>(), published: unknown[] = [];
  let resolve: ((value: ReadingInsights) => void) | undefined, calls = 0, disposed = 0;
  const ctx = { locale: "en", domains: { reading: { queries: { stats: { insights: async () => {
    calls++; if (calls === 2 || calls === 4) return new Promise<ReadingInsights>(r => { resolve = r; });
    if (calls === 3) throw { code: "reading/stats-stale", message: "PRIVATE" };
    return sample;
  } } }, events: { subscribe: (type: string, handler: typeof handlers extends Map<string, infer H> ? H : never) => {
    handlers.set(type, handler); return { dispose() { disposed++; handlers.delete(type); } };
  } } } }, services: { ui: { publishView: async (_channel: unknown, update: unknown) => { published.push(update); } } } } as unknown as PluginContext;
  const view = await readingInsightsView(ctx, { bookId: "b" }) as PluginDetailView & PluginView;
  const subscription = await view.live!.subscribe({ id: "v" });
  handlers.get("book.sessionRecorded")!({ payload: { bookId: "other" } });
  expect(calls).toBe(2);
  handlers.get("book.sessionRecorded")!({ payload: { bookId: "b" } });
  handlers.get("book.timeRecorded")!({ payload: { bookId: "b" } });
  resolve!(sample); await tick(); expect(calls).toBe(3); expect(published).toHaveLength(2);
  expect(JSON.stringify(published[1])).toContain('"code":"reading/stats-stale"');
  expect(JSON.stringify(published[1])).not.toContain("PRIVATE");
  expect(JSON.stringify(published[1])).toContain("Last successful sample");
  const hours = await view.actions!.find(action => action.id === "hours")!.run();
  expect(hours).toMatchObject({ view: { title: "Reading hours (all time)", items: expect.any(Array) } });
  handlers.get("book.sessionRecorded")!({ payload: { bookId: "b" } });
  subscription.dispose(); resolve!(sample); await tick(); expect(published).toHaveLength(2); expect(disposed).toBe(2);
  const form = readingInsightsForm(ctx, "b") as PluginFormView;
  expect(form.fields[0]).toMatchObject({ kind: "choice", value: "week", options: expect.any(Array) });
});

test("all eight locales provide every trend label", () => {
  const keys = Object.keys(insightsCopy("en"));
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
    const copy = insightsCopy(locale); expect(Object.keys(copy)).toEqual(keys);
    expect(Object.values(copy).every(value => typeof value === "string" && value.length > 0)).toBe(true);
  }
});
