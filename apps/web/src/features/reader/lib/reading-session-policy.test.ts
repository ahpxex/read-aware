import { describe, expect, test } from "bun:test";
import {
  bucketKeyAt,
  IDLE_LIMIT_MS,
  MAX_TICK_MS,
  MIN_TICK_MS,
  PAUSE_MS,
  pausedLongEnough,
  sameBucket,
  tickDelta,
} from "./reading-session-policy";

describe("reading session policy", () => {
  test("buckets are keyed by book and local hour", () => {
    const t = new Date(2026, 8, 7, 15, 10).getTime();
    const key = bucketKeyAt("b1", t);
    expect(key).toEqual({ bookId: "b1", localDay: "2026-09-07", localHour: 15 });
    expect(sameBucket(key, bucketKeyAt("b1", t + 30 * 60_000))).toBe(true);
    expect(sameBucket(key, bucketKeyAt("b1", t + 60 * 60_000))).toBe(false);
    expect(sameBucket(key, bucketKeyAt("b2", t))).toBe(false);
  });

  test("a tick banks time only while genuinely reading, and never a sleep gap", () => {
    const base = { now: 100_000, lastTickAt: 80_000, lastActivityAt: 95_000, active: true, foreground: true };
    expect(tickDelta(base)).toBe(20_000);
    expect(tickDelta({ ...base, active: false })).toBe(0);
    expect(tickDelta({ ...base, foreground: false })).toBe(0);
    expect(tickDelta({ ...base, lastActivityAt: base.now - IDLE_LIMIT_MS - 1 })).toBe(0);
    expect(tickDelta({ ...base, lastTickAt: base.now - 10 * 60_000 })).toBe(MAX_TICK_MS);
    expect(tickDelta({ ...base, lastTickAt: base.now + 5 })).toBe(0);
    // A remount fires cleanup a millisecond after the clocks reset: not reading.
    expect(tickDelta({ ...base, lastTickAt: base.now - 1 })).toBe(0);
    expect(tickDelta({ ...base, lastTickAt: base.now - MIN_TICK_MS })).toBe(MIN_TICK_MS);
  });

  test("a pause closes the session before the idle limit stops counting", () => {
    expect(PAUSE_MS).toBeLessThan(IDLE_LIMIT_MS);
    expect(pausedLongEnough(100_000, 100_000 - PAUSE_MS + 1)).toBe(false);
    expect(pausedLongEnough(100_000, 100_000 - PAUSE_MS)).toBe(true);
  });
});
