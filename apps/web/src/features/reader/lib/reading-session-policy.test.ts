import { describe, expect, test } from "bun:test";
import {
  ActiveReadingClock,
  bucketKeyAt,
  IDLE_LIMIT_MS,
  MAX_SAMPLE_GAP_MS,
  PAUSE_MS,
  pausedLongEnough,
  sameBucket,
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

  test("the clock counts foreground time within the idle limit and never an unobserved gap", () => {
    const clock = new ActiveReadingClock(0, true);
    clock.sample(20_000);
    expect(clock.totalMs).toBe(20_000);
    // Idle: counting stops exactly at the limit, even mid-sample.
    for (let at = 40_000; at <= IDLE_LIMIT_MS + 30_000; at += 20_000) clock.sample(at);
    expect(clock.totalMs).toBe(IDLE_LIMIT_MS);
    expect(clock.idleMs(IDLE_LIMIT_MS + 30_000)).toBe(IDLE_LIMIT_MS + 30_000);
    // Acting again resumes it.
    clock.activity(IDLE_LIMIT_MS + 30_000, true);
    clock.sample(IDLE_LIMIT_MS + 40_000);
    expect(clock.totalMs).toBe(IDLE_LIMIT_MS + 10_000);
  });

  test("background time and a suspended webview's gap count for nothing", () => {
    const clock = new ActiveReadingClock(0, true);
    clock.setForeground(5_000, false);
    clock.sample(15_000);
    expect(clock.totalMs).toBe(5_000);
    // Returning to the foreground counts as acting, so a long absence resumes at once.
    clock.setForeground(15 * 60_000, true);
    clock.sample(15 * 60_000 + 1_000);
    expect(clock.totalMs).toBe(6_000);
    clock.sample(15 * 60_000 + 1_000 + MAX_SAMPLE_GAP_MS + 1);
    expect(clock.totalMs).toBe(6_000);
    clock.sample(15 * 60_000 + 2_000 + MAX_SAMPLE_GAP_MS);
    expect(clock.totalMs).toBe(6_999);
    // Out-of-order samples never subtract.
    clock.sample(10);
    expect(clock.totalMs).toBe(6_999);
  });

  test("two readers of one clock see the same seconds from their own marks", () => {
    const clock = new ActiveReadingClock(0, true);
    clock.sample(30_000);
    const timerMark = clock.totalMs;
    for (let at = 31_000; at <= 90_000; at += 1_000) clock.sample(at);
    expect(clock.totalMs - timerMark).toBe(60_000);
    expect(clock.totalMs).toBe(90_000);
  });

  test("a pause closes the session before the idle limit stops counting", () => {
    expect(PAUSE_MS).toBeLessThan(IDLE_LIMIT_MS);
    expect(pausedLongEnough(PAUSE_MS - 1)).toBe(false);
    expect(pausedLongEnough(PAUSE_MS)).toBe(true);
  });
});
