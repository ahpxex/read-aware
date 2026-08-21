import { describe, expect, test } from "bun:test";
import { compareTrends, trendFromSummary, type SuiteTrend } from "./trend";
import type { EvalSummary } from "./types";

function summary(byScenario: EvalSummary["byScenario"]): EvalSummary {
  return {
    suiteId: "tools",
    baselineVariantId: "baseline",
    generatedAt: "2026-08-10T06:00:00Z",
    runs: 6,
    passed: 5,
    failed: 1,
    errors: 0,
    byVariant: [],
    byScenario,
    byTag: [],
    comparisons: [],
  };
}

function aggregate(scenarioId: string, passRate: number, meanScore: number) {
  return {
    variantId: "baseline",
    scenarioId,
    runs: 3,
    passed: Math.round(passRate * 3),
    failed: 3 - Math.round(passRate * 3),
    errors: 0,
    passRate,
    meanScore,
    telemetry: {},
  };
}

describe("suite trend", () => {
  test("extracts baseline per-scenario entries and tag rollups from a summary", () => {
    const trend = trendFromSummary(
      summary([aggregate("a", 1, 1), { ...aggregate("b", 0.5, 0.8), variantId: "candidate" }]),
      "deepseek:deepseek-v4-flash",
      undefined,
      new Map([
        ["a", ["honesty", "book"]],
        ["b", ["honesty"]],
      ]),
    );
    expect(trend.scenarios).toEqual([
      { scenarioId: "a", passRate: 1, meanScore: 1, runs: 3, tags: ["honesty", "book"] },
    ]);
    expect(trend.model).toBe("deepseek:deepseek-v4-flash");
  });

  test("marks regressions, reports improvements, and stays quiet on no change", () => {
    const previous: SuiteTrend = {
      suiteId: "tools",
      baselineVariantId: "baseline",
      model: "deepseek:deepseek-v4-flash",
      generatedAt: "2026-08-09T00:00:00Z",
      scenarios: [
        { scenarioId: "steady", passRate: 1, meanScore: 1, runs: 3 },
        { scenarioId: "worse", passRate: 1, meanScore: 1, runs: 3 },
        { scenarioId: "better", passRate: 0.33, meanScore: 0.6, runs: 3 },
      ],
    };
    const current = trendFromSummary(
      summary([
        aggregate("steady", 1, 1),
        aggregate("worse", 0.67, 0.9),
        aggregate("better", 1, 1),
      ]),
      "deepseek:deepseek-v4-flash",
    );
    const lines = compareTrends(previous, current);
    expect(lines.some((line) => line.startsWith("! worse:"))).toBe(true);
    expect(lines.some((line) => line.includes("better:"))).toBe(true);
    expect(lines.some((line) => line.includes("steady"))).toBe(false);
  });

  test("reports tag-level rollup changes alongside per-scenario deltas", () => {
    const withTags = (entries: SuiteTrend["scenarios"], byTag: SuiteTrend["byTag"]): SuiteTrend => ({
      suiteId: "tools",
      baselineVariantId: "baseline",
      model: "deepseek:deepseek-v4-flash",
      generatedAt: "2026-08-09T00:00:00Z",
      scenarios: entries,
      byTag,
    });
    const previous = withTags(
      [
        { scenarioId: "a", passRate: 1, meanScore: 1, runs: 3, tags: ["honesty"] },
        { scenarioId: "b", passRate: 1, meanScore: 1, runs: 3, tags: ["honesty"] },
      ],
      [{ tag: "honesty", passRate: 1, meanScore: 1, runs: 6 }],
    );
    const current = withTags(
      [
        { scenarioId: "a", passRate: 0.67, meanScore: 0.8, runs: 3, tags: ["honesty"] },
        { scenarioId: "b", passRate: 1, meanScore: 1, runs: 3, tags: ["honesty"] },
      ],
      [{ tag: "honesty", passRate: 0.84, meanScore: 0.9, runs: 6 }],
    );
    const lines = compareTrends(previous, current);
    expect(lines.some((line) => line.includes("Tag rollup"))).toBe(true);
    expect(lines.some((line) => line.startsWith("! tag honesty:"))).toBe(true);
  });

  test("suppresses deltas when the eval definition changed", () => {
    const previous: SuiteTrend = {
      suiteId: "tools",
      definitionHash: "sha256:old",
      baselineVariantId: "baseline",
      model: "deepseek:deepseek-v4-flash",
      generatedAt: "2026-08-09T00:00:00Z",
      scenarios: [{ scenarioId: "a", passRate: 1, meanScore: 1, runs: 1 }],
    };
    const current: SuiteTrend = {
      ...previous,
      definitionHash: "sha256:new",
      generatedAt: "2026-08-10T00:00:00Z",
      scenarios: [{ scenarioId: "a", passRate: 0, meanScore: 0, runs: 1 }],
    };
    const lines = compareTrends(previous, current);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("INCOMPARABLE");
    expect(lines[0]).toContain("deltas are suppressed");
  });
});
