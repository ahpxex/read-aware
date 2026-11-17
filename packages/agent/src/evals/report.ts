import { qualityVerdict, qualitySummaryText } from "./reviews";
import type { EvalAggregate, EvalComparison, EvalRunRecord, EvalSummary, EvalTokenUsage } from "./types";

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
    aggregate.telemetry.meanCostUsd === undefined ? "n/a" : `$${aggregate.telemetry.meanCostUsd.toFixed(6)}`,
  ].join(" | ");
}

function comparisonLines(comparison: EvalComparison): string[] {
  const tokenDelta = comparison.telemetryDelta.meanTokens;
  return [
    `### ${comparison.candidateVariantId} vs ${comparison.baselineVariantId}`,
    "",
    `Paired runs: ${comparison.pairedRuns}`,
    "",
    `- Diagnostic pass-rate delta: ${signedPercent(comparison.passRateDelta)}`,
    `- Diagnostic score delta: ${signed(comparison.meanScoreDelta)}`,
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

function tagRow(aggregate: EvalAggregate): string {
  return [
    aggregate.tag,
    aggregate.variantId,
    `${aggregate.passed}/${aggregate.runs}`,
    percent(aggregate.passRate),
    fixed(aggregate.meanScore, 3),
  ].join(" | ");
}

export function formatEvalReport(summary: EvalSummary): string {
  const suiteTitle = summary.suiteDisplayName ? `${summary.suiteDisplayName} (${summary.suiteId})` : summary.suiteId;
  const lines = [
    `# Eval Report: ${suiteTitle}`,
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    `Quality: ${qualitySummaryText(summary.quality ?? { total: summary.runs, pass: 0, partial: 0, fail: 0, pending: summary.runs - summary.errors, error: summary.errors })}`,
    "",
    "Primary-agent / human review determines quality. Automated checks and optional model opinions below are diagnostics, not acceptance.",
    "",
    `Diagnostics: ${summary.passed}/${summary.runs} checks passed | ${summary.failed} checks failed | ${summary.errors} errors`,
    "",
    "## Primary review by variant",
    "",
    "Variant | Pass | Partial | Fail | Pending | Error",
    "--- | ---: | ---: | ---: | ---: | ---:",
    ...(summary.qualityByVariant ?? []).map(
      (q) => `${q.variantId} | ${q.pass} | ${q.partial} | ${q.fail} | ${q.pending} | ${q.error}`,
    ),
    "",
    ...(summary.manualQuality ? [`Freeform reviews: ${qualitySummaryText(summary.manualQuality)}`, ""] : []),
    "## Diagnostic variants",
    "",
    "Variant | Scenario | Checks passed | Check pass rate | Check score | Mean wall ms | Mean tokens | Mean cost",
    "--- | --- | ---: | ---: | ---: | ---: | --- | ---:",
    ...summary.byVariant.map(aggregateRow),
    "",
    "## Diagnostic scenarios",
    "",
    "Variant | Scenario | Checks passed | Check pass rate | Check score | Mean wall ms | Mean tokens | Mean cost",
    "--- | --- | ---: | ---: | ---: | ---: | --- | ---:",
    ...summary.byScenario.map(aggregateRow),
    "",
  ];
  if (summary.byTag.length > 0) {
    lines.push(
      "## Diagnostic tags",
      "",
      "Tag | Variant | Checks passed | Check pass rate | Check score",
      "--- | --- | ---: | ---: | ---:",
      ...summary.byTag.map(tagRow),
      "",
    );
  }
  if (summary.comparisons.length > 0) {
    lines.push("## Diagnostic comparisons", "", ...summary.comparisons.flatMap(comparisonLines));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Why a run did not pass its checks, in the terms that decide what to do next:
 * an environment failure says nothing about the agent, and only what is left
 * is the model's own answer or tool use.
 */
export type RunCause = "timeout" | "provider" | "setup" | "harness" | "tool-error" | "answer";

export function runCause(record: EvalRunRecord): RunCause | undefined {
  if (record.error) {
    if (record.error.stage === "timeout") return "timeout";
    if (record.error.stage === "setup") return "setup";
    return record.error.code?.startsWith("ai/") ? "provider" : "harness";
  }
  if (record.status !== "failed") return undefined;
  const failed = record.assessment?.checks.filter((check) => !check.passed) ?? [];
  return failed.length > 0 && failed.every((check) => check.id.startsWith("tool.")) ? "tool-error" : "answer";
}

const CAUSE_LABELS: Record<RunCause, string> = {
  timeout: "timed out",
  provider: "model provider error",
  setup: "scenario setup failed",
  harness: "harness error",
  "tool-error": "tool use",
  answer: "the answer itself",
};

/** "3 the answer itself, 2 tool use, 1 timed out", most frequent first; empty when all passed. */
export function formatRunCauses(records: readonly EvalRunRecord[]): string {
  const counts = new Map<RunCause, number>();
  for (const record of records) {
    const cause = runCause(record);
    if (cause) counts.set(cause, (counts.get(cause) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([cause, count]) => `${count} ${CAUSE_LABELS[cause]}`)
    .join(", ");
}

export function formatRunLine(record: EvalRunRecord): string {
  const verdict = qualityVerdict(record);
  const label = verdict === "pending" ? "REVIEW PENDING" : verdict.toUpperCase();
  const duration = `${record.telemetry.wallTimeMs.toFixed(0)}ms`;
  const score = record.assessment
    ? ` diagnosticScore=${record.assessment.score.toFixed(2)} checks=${record.status}`
    : "";
  const error = record.error ? ` ${record.error.stage}: ${record.error.message}` : "";
  const cause = runCause(record);
  return `[${label}] ${record.variantId} / ${record.scenarioId} #${record.repetition} ${duration}${score}${record.assessment?.modelReview ? ` modelOpinion=${record.assessment.modelReview.verdict}` : ""}${error}${cause ? ` cause=${cause}` : ""}`;
}

export function formatRunFailures(record: EvalRunRecord): string[] {
  return (
    record.assessment?.checks
      .filter((check) => !check.passed)
      .map((check) => `  - ${check.category}: ${check.message}`) ?? []
  );
}
