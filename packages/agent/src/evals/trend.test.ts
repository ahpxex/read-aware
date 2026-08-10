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
  test("extracts baseline per-scenario entries from a summary", () => {
    const trend = trendFromSummary(
      summary([aggregate("a", 1, 1), { ...aggregate("b", 0.5, 0.8), variantId: "candidate" }]),
      "deepseek:deepseek-v4-flash",
    );
    expect(trend.scenarios).toEqual([
      { scenarioId: "a", passRate: 1, meanScore: 1, runs: 3 },
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
});
