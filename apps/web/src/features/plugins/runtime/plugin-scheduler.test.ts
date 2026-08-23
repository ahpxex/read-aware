import { describe, expect, test } from "bun:test";
import {
  inspectPluginSchedules,
  isScheduleDue,
  registerPluginSchedule,
} from "./plugin-scheduler";

const NOW = Date.parse("2026-08-05T12:00:00Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * 60_000).toISOString();

describe("isScheduleDue", () => {
  test("a never-run schedule is due (launch catch-up)", () => {
    expect(isScheduleDue(undefined, 60, NOW)).toBe(true);
  });

  test("due only after the cadence elapses", () => {
    expect(isScheduleDue(minutesAgo(59), 60, NOW)).toBe(false);
    expect(isScheduleDue(minutesAgo(60), 60, NOW)).toBe(true);
    expect(isScheduleDue(minutesAgo(600), 60, NOW)).toBe(true);
  });

  test("cadence floors at the host minimum", () => {
    // Declared 1 minute, floored to 15: not due after 10.
    expect(isScheduleDue(minutesAgo(10), 1, NOW)).toBe(false);
    expect(isScheduleDue(minutesAgo(15), 1, NOW)).toBe(true);
  });

  test("garbled or future stamps never wedge the task", () => {
    expect(isScheduleDue("not-a-date", 60, NOW)).toBe(true);
    expect(isScheduleDue(minutesAgo(-120), 60, NOW)).toBe(true);
  });
});

describe("schedule registration lifecycle", () => {
  test("a stale disposable cannot remove a replacement schedule", () => {
    const first = registerPluginSchedule(
      "test-plugin",
      { id: "refresh", label: "Refresh", everyMinutes: 60 },
      () => {},
    );
    const second = registerPluginSchedule(
      "test-plugin",
      { id: "refresh", label: "Refresh", everyMinutes: 60 },
      () => {},
    );

    first.dispose();
    expect(inspectPluginSchedules()).toContain("test-plugin:refresh");
    second.dispose();
    expect(inspectPluginSchedules()).not.toContain("test-plugin:refresh");
  });
});
