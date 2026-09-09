import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildReadingInsightsTool } from "./reading-insights";

test("insights tool scopes, formats a bounded result and suppresses cancelled output", async () => {
  const { deps } = createInMemoryDeps(), calls: unknown[] = [];
  const original = deps.library.getReadingInsights;
  deps.library.getReadingInsights = async query => { calls.push(query); return { ...await original(query), totalMs: 1234 }; };
  const tool = buildReadingInsightsTool({ kind: "book", bookId: "book" }, deps);
  const result = await tool.execute("one", { period: "year", asOfDay: "2026-09-09" });
  expect(calls[0]).toEqual({ bookId: "book", period: "year", asOfDay: "2026-09-09" });
  expect(result.content[0]).toMatchObject({ text: expect.stringContaining('"readingSeconds":1.234') });
  await tool.execute("all", { allBooks: true }); expect(calls[1]).toEqual({ period: "week" });
  await expect(tool.execute("invalid", { period: "invalid" })).rejects.toMatchObject({ code: "reading/invalid-time-query" });
  const abort = new AbortController();
  deps.library.getReadingInsights = async query => { abort.abort(); return original(query); };
  await expect(tool.execute("cancel", {}, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
});

test("largest report stays bounded and preserves all date, weekday and hour slots", async () => {
  const { deps } = createInMemoryDeps();
  const original = deps.library.getReadingInsights;
  const bookId = "\u0001".repeat(256);
  deps.library.getReadingInsights = async query => {
    const report = await original(query);
    return { ...report, bookId, totalMs: Number.MAX_SAFE_INTEGER,
      bars: Array.from({ length: 36 }, (_, index) => ({ key: `${2024 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`, ms: Number.MAX_SAFE_INTEGER, isCurrent: index === 35 })),
      weekdayMs: Array(7).fill(Number.MAX_SAFE_INTEGER), allTimeHourlyMs: Array(24).fill(Number.MAX_SAFE_INTEGER),
      achievements: { ...report.achievements, mostReadBookId: bookId } };
  };
  const result = await buildReadingInsightsTool({ kind: "global", threadId: "g" }, deps).execute("bounded", { period: "all" });
  const content = result.content[0];
  if (content.type !== "text") throw Error("Expected text result");
  expect(content.text.length).toBeLessThan(16_000);
  const data = JSON.parse(content.text);
  expect(data.bars).toHaveLength(36);
  expect(data.weekdaySecondsMondayFirst).toHaveLength(7);
  expect(data.allTimeHourlySeconds).toHaveLength(24);
  expect(data.bookId).toBe(bookId);
  expect(data.allTimeAchievements.mostReadBookId).toBe(bookId);
  expect(content.text).not.toContain('"totalMs"');
});
