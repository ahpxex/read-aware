import type {
  EvalAggregate,
  EvalComparison,
  EvalRunRecord,
  EvalSummary,
  EvalTokenUsage,
} from "./types";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signedPercent(value: number): string {
  const points = value * 100;
  return `${points >= 0 ? "+" : ""}${points.toFixed(1)} pp`;
}

function fixed(value: number | undefined, digits = 1): string {
  return value === undefined ? "n/a" : value.toFixed(digits);
}

function signed(value: number | undefined, suffix = ""): string {
  if (value === undefined) return "n/a";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;
}

function tokenSummary(tokens: EvalTokenUsage | undefined): string {
  if (!tokens) return "n/a";
  return `${tokens.total.toFixed(0)} total (${tokens.input.toFixed(0)} in, ${tokens.output.toFixed(0)} out, ${tokens.cacheRead.toFixed(0)} cached)`;
}

function aggregateRow(aggregate: EvalAggregate): string {
  return [
    aggregate.variantId,
    aggregate.scenarioId ?? "all",
    `${aggregate.passed}/${aggregate.runs}`,
    percent(aggregate.passRate),
    fixed(aggregate.meanScore, 3),
    fixed(aggregate.telemetry.meanWallTimeMs, 0),
    tokenSummary(aggregate.telemetry.meanTokens),
    aggregate.telemetry.meanCostUsd === undefined
      ? "n/a"
      : `$${aggregate.telemetry.meanCostUsd.toFixed(6)}`,
  ].join(" | ");
}

function comparisonLines(comparison: EvalComparison): string[] {
  const tokenDelta = comparison.telemetryDelta.meanTokens;
  return [
    `### ${comparison.candidateVariantId} vs ${comparison.baselineVariantId}`,
    "",
    `Paired runs: ${comparison.pairedRuns}`,
    "",
    `- Pass-rate delta: ${signedPercent(comparison.passRateDelta)}`,
    `- Mean-score delta: ${signed(comparison.meanScoreDelta)}`,
    `- Wall-time delta: ${signed(comparison.telemetryDelta.meanWallTimeMs, " ms")}`,
    `- Token delta: ${tokenDelta ? signed(tokenDelta.total) : "n/a"}`,
    `- Cost delta: ${
      comparison.telemetryDelta.meanCostUsd === undefined
        ? "n/a"
        : `${comparison.telemetryDelta.meanCostUsd >= 0 ? "+" : ""}$${comparison.telemetryDelta.meanCostUsd.toFixed(6)}`
    }`,
    "",
  ];
}

export function formatEvalReport(summary: EvalSummary): string {
  const lines = [
    `# Eval Report: ${summary.suiteId}`,
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    `Runs: ${summary.runs} | Passed: ${summary.passed} | Failed: ${summary.failed} | Errors: ${summary.errors}`,
    "",
    "## Variants",
    "",
    "Variant | Scenario | Passed | Pass rate | Mean score | Mean wall ms | Mean tokens | Mean cost",
    "--- | --- | ---: | ---: | ---: | ---: | --- | ---:",
    ...summary.byVariant.map(aggregateRow),
    "",
    "## Scenarios",
    "",
    "Variant | Scenario | Passed | Pass rate | Mean score | Mean wall ms | Mean tokens | Mean cost",
    "--- | --- | ---: | ---: | ---: | ---: | --- | ---:",
    ...summary.byScenario.map(aggregateRow),
    "",
  ];
  if (summary.comparisons.length > 0) {
    lines.push(
      "## Comparisons",
      "",
      ...summary.comparisons.flatMap(comparisonLines),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function formatRunLine(record: EvalRunRecord): string {
  const label = record.status.toUpperCase().padEnd(6);
  const duration = `${record.telemetry.wallTimeMs.toFixed(0)}ms`;
  const score = record.assessment ? ` score=${record.assessment.score.toFixed(2)}` : "";
  const error = record.error ? ` ${record.error.stage}: ${record.error.message}` : "";
  return `[${label}] ${record.variantId} / ${record.scenarioId} #${record.repetition} ${duration}${score}${error}`;
}

export function formatRunFailures(record: EvalRunRecord): string[] {
  return (
    record.assessment?.checks
      .filter((check) => !check.passed)
      .map((check) => `  - ${check.category}: ${check.message}`) ?? []
  );
}
