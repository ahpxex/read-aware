import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildReadingTimeTool } from "./reading-time";

test("time query defaults to current book, supports explicit aggregate and preserves scope on pagination", async () => {
  const { deps } = createInMemoryDeps();
  const queries: unknown[] = [];
  const original = deps.library.getReadingTime;
  deps.library.getReadingTime = async query => { queries.push(query); return { ...await original(query), settledMs: 1000, pendingMs: 2000, totalMs: 3000 }; };
  const tool = buildReadingTimeTool({ kind: "book", bookId: "b" }, deps);
  const result = await tool.execute("one", {});
  expect(queries[0]).toEqual({ bookId: "b", limit: 10 });
  expect(result.content[0]).toMatchObject({ text: expect.stringContaining('"totalReadingSeconds":3') });
  await tool.execute("all", { allBooks: true, localDay: "2026-09-09", limit: 1 });
  expect(queries[1]).toEqual({ localDay: "2026-09-09", limit: 1 });
  await expect(tool.execute("cross", { after: { bookId: "other", localDay: "2026-09-09", localHour: 1 } })).rejects.toMatchObject({ code: "reading/invalid-time-query" });
  expect(queries).toHaveLength(2);
});

test("time query cancellation suppresses late output without flushing sessions", async () => {
  const { deps, stores } = createInMemoryDeps();
  const original = deps.library.getReadingTime, abort = new AbortController();
  deps.library.getReadingTime = async query => { abort.abort(); return original(query); };
  const tool = buildReadingTimeTool({ kind: "global", threadId: "time" }, deps);
  await expect(tool.execute("time", {}, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(stores.interactions).toHaveLength(0);
});

test("time result formats clocks, preserves exact seconds and bounds the worst-case page", async () => {
  const { deps } = createInMemoryDeps();
  const original = deps.library.getReadingTime;
  const clock = 1_788_960_000_000, bookId = "x" + "\u0001".repeat(255);
  deps.library.getReadingTime = async query => ({ ...await original(query), observedAtEpochMs: clock,
    pending: Array.from({ length: 10 }, (_, localHour) => ({ bookId, localDay: "2026-09-09", localHour,
      ms: 1234, startedAt: clock, lastAt: clock, positionAt: localHour === 0 ? null : clock })),
    pendingMs: 12340, totalMs: 12340, pendingBucketCount: 11,
    nextCursor: { bookId, localDay: "2026-09-09", localHour: 9 } });
  const tool = buildReadingTimeTool({ kind: "global", threadId: "time" }, deps);
  const result = await tool.execute("formatted", { limit: 10 });
  const content = result.content[0]; if (content.type !== "text") throw Error("Expected text");
  const value = JSON.parse(content.text);
  expect(value.totalReadingSeconds).toBe(12.34);
  expect(value.pending[0].positionAt).toBeNull();
  expect(value.pending[1].positionAt).toBe(new Date(clock).toISOString());
  expect(value.pending[0].readingSeconds).toBe(1.234);
  expect(value.pending.length).toBeLessThan(10);
  expect(value.nextCursor.localHour).toBe(value.pending.at(-1).localHour);
  expect(content.text).not.toMatch(/"\w*Ms"\s*:|\b1[6-9]\d{11}\b/);
  expect(content.text.length).toBeLessThanOrEqual(16_000);
  await expect(tool.execute("too-large", { limit: 11 })).rejects.toMatchObject({ code: "reading/invalid-time-query" });
});
