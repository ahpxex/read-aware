import type {
  EvalAggregate,
  EvalComparison,
  EvalRunRecord,
  EvalSummary,
  EvalTelemetry,
  EvalTokenUsage,
} from "./types";

type NumericTelemetryKey = Exclude<keyof EvalTelemetry, "tokens">;

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function meanField(records: EvalRunRecord[], key: NumericTelemetryKey): number | undefined {
  return mean(
    records.flatMap((record) => {
      const value = record.telemetry[key];
      return typeof value === "number" ? [value] : [];
    }),
  );
}

function meanTokens(records: EvalRunRecord[]): EvalTokenUsage | undefined {
  const values = records.flatMap((record) =>
    record.telemetry.tokens ? [record.telemetry.tokens] : [],
  );
  if (values.length === 0) return undefined;
  const field = (key: keyof EvalTokenUsage) =>
    values.reduce((total, value) => total + value[key], 0) / values.length;
  return {
    input: field("input"),
    output: field("output"),
    cacheRead: field("cacheRead"),
    cacheWrite: field("cacheWrite"),
    total: field("total"),
  };
}

function score(record: EvalRunRecord): number {
  return record.status === "error" ? 0 : (record.assessment?.score ?? 0);
}

function aggregate(
  records: EvalRunRecord[],
  variantId: string,
  scenarioId?: string,
): EvalAggregate {
  const selected = records.filter(
    (record) =>
      record.variantId === variantId &&
      (scenarioId === undefined || record.scenarioId === scenarioId),
  );
  const passed = selected.filter((record) => record.status === "passed").length;
  const failed = selected.filter((record) => record.status === "failed").length;
  const errors = selected.filter((record) => record.status === "error").length;
  return {
    variantId,
    ...(scenarioId === undefined ? {} : { scenarioId }),
    runs: selected.length,
    passed,
    failed,
    errors,
    passRate: selected.length === 0 ? 0 : passed / selected.length,
    meanScore:
      selected.length === 0
        ? 0
        : selected.reduce((total, record) => total + score(record), 0) / selected.length,
    telemetry: {
      meanWallTimeMs: meanField(selected, "wallTimeMs"),
      meanModelTimeMs: meanField(selected, "modelTimeMs"),
      meanTtfbMs: meanField(selected, "meanTtfbMs"),
      meanRounds: meanField(selected, "rounds"),
      meanTokens: meanTokens(selected),
      meanCostUsd: meanField(selected, "costUsd"),
    },
  };
}

function subtractOptional(
  candidate: number | undefined,
  baseline: number | undefined,
): number | undefined {
  return candidate === undefined || baseline === undefined ? undefined : candidate - baseline;
}

function pairedMean(
  pairs: Array<[EvalRunRecord, EvalRunRecord]>,
  read: (record: EvalRunRecord) => number | undefined,
): number | undefined {
  const deltas = pairs.flatMap(([baseline, candidate]) => {
    const baselineValue = read(baseline);
    const candidateValue = read(candidate);
    return baselineValue === undefined || candidateValue === undefined
      ? []
      : [candidateValue - baselineValue];
  });
  return mean(deltas);
}

function pairedTokens(
  pairs: Array<[EvalRunRecord, EvalRunRecord]>,
): EvalTokenUsage | undefined {
  const keys: Array<keyof EvalTokenUsage> = [
    "input",
    "output",
    "cacheRead",
    "cacheWrite",
    "total",
  ];
  const values = Object.fromEntries(
    keys.map((key) => [
      key,
      pairedMean(pairs, (record) => record.telemetry.tokens?.[key]),
    ]),
  ) as Record<keyof EvalTokenUsage, number | undefined>;
  if (keys.some((key) => values[key] === undefined)) return undefined;
  return values as EvalTokenUsage;
}

function compare(
  records: EvalRunRecord[],
  baselineVariantId: string,
  candidateVariantId: string,
): EvalComparison {
  const baseline = new Map(
    records
      .filter((record) => record.variantId === baselineVariantId)
      .map((record) => [`${record.scenarioId}:${record.repetition}`, record]),
  );
  const pairs = records
    .filter((record) => record.variantId === candidateVariantId)
    .flatMap((candidate) => {
      const baselineRecord = baseline.get(`${candidate.scenarioId}:${candidate.repetition}`);
      return baselineRecord ? ([[baselineRecord, candidate]] as Array<[EvalRunRecord, EvalRunRecord]>) : [];
    });
  const baselinePassRate = mean(
    pairs.map(([record]) => (record.status === "passed" ? 1 : 0)),
  );
  const candidatePassRate = mean(
    pairs.map(([, record]) => (record.status === "passed" ? 1 : 0)),
  );

  return {
    baselineVariantId,
    candidateVariantId,
    pairedRuns: pairs.length,
    passRateDelta: subtractOptional(candidatePassRate, baselinePassRate) ?? 0,
    meanScoreDelta: mean(pairs.map(([base, candidate]) => score(candidate) - score(base))) ?? 0,
    telemetryDelta: {
      meanWallTimeMs: pairedMean(pairs, (record) => record.telemetry.wallTimeMs),
      meanModelTimeMs: pairedMean(pairs, (record) => record.telemetry.modelTimeMs),
      meanTtfbMs: pairedMean(pairs, (record) => record.telemetry.meanTtfbMs),
      meanRounds: pairedMean(pairs, (record) => record.telemetry.rounds),
      meanTokens: pairedTokens(pairs),
      meanCostUsd: pairedMean(pairs, (record) => record.telemetry.costUsd),
    },
  };
}

export function buildEvalSummary(
  suiteId: string,
  variantIds: string[],
  scenarioIds: string[],
  records: EvalRunRecord[],
  tagsByScenario: ReadonlyMap<string, readonly string[]> = new Map(),
  definitionHash?: string,
): EvalSummary {
  const baselineVariantId = variantIds[0] ?? "baseline";
  // 场景按标签分桶后逐 (tag, variant) 聚合：byTag 是"测什么"维度的机器可读汇总
  const scenariosByTag = new Map<string, string[]>();
  for (const scenarioId of scenarioIds) {
    for (const tag of tagsByScenario.get(scenarioId) ?? []) {
      scenariosByTag.set(tag, [...(scenariosByTag.get(tag) ?? []), scenarioId]);
    }
  }
  return {
    suiteId,
    ...(definitionHash ? { definitionHash } : {}),
    baselineVariantId,
    generatedAt: new Date().toISOString(),
    runs: records.length,
    passed: records.filter((record) => record.status === "passed").length,
    failed: records.filter((record) => record.status === "failed").length,
    errors: records.filter((record) => record.status === "error").length,
    byVariant: variantIds.map((variantId) => aggregate(records, variantId)),
    byScenario: variantIds.flatMap((variantId) =>
      scenarioIds.map((scenarioId) => aggregate(records, variantId, scenarioId)),
    ),
    byTag: [...scenariosByTag.keys()]
      .sort()
      .flatMap((tag) =>
        variantIds.flatMap((variantId) => {
          const members = new Set(scenariosByTag.get(tag));
          const entry = aggregate(
            records.filter((record) => members.has(record.scenarioId)),
            variantId,
          );
          return entry.runs === 0 ? [] : [{ ...entry, tag }];
        }),
      ),
    comparisons: variantIds
      .slice(1)
      .map((candidateVariantId) => compare(records, baselineVariantId, candidateVariantId)),
  };
}
