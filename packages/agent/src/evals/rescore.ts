import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { formatEvalReport } from "./report";
import { buildEvalSummary } from "./summary";
import { evalSuites, isEvalSuiteId } from "./suites";
import type { AgentEvalScenario } from "./agent-harness";
import type {
  EvalRunPlan,
  EvalRunRecord,
  EvalScenario,
  EvalSuite,
  EvalSummary,
} from "./types";

interface StoredManifest {
  schemaVersion: number;
  plan: EvalRunPlan;
}

export interface RescoreResult {
  records: EvalRunRecord[];
  summary: EvalSummary;
  summaryPath?: string;
  reportPath?: string;
  recordsPath?: string;
}

function scoringError(error: unknown) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  return {
    stage: "scoring" as const,
    name: normalized.name,
    message: normalized.message,
    ...(normalized.stack ? { stack: normalized.stack } : {}),
  };
}

export async function rescoreEvalRecords<
  TScenario extends EvalScenario<never>,
>(
  suite: EvalSuite<TScenario>,
  variantIds: string[],
  records: EvalRunRecord[],
): Promise<RescoreResult> {
  const scenarios = new Map(suite.scenarios.map((scenario) => [scenario.id, scenario]));
  const rescored: EvalRunRecord[] = [];
  for (const record of records) {
    const scenario = scenarios.get(record.scenarioId);
    if (!scenario) throw new Error(`record references unknown scenario ${record.scenarioId}`);
    if (record.output === undefined) {
      rescored.push(record);
      continue;
    }
    try {
      type Observation = TScenario extends EvalScenario<infer T> ? T : never;
      const evaluate = scenario.evaluate as EvalScenario<Observation>["evaluate"];
      const assessment = await evaluate(record.output as unknown as Observation);
      const next: EvalRunRecord = {
        ...record,
        status: assessment.passed ? "passed" : "failed",
        assessment,
      };
      delete next.error;
      rescored.push(next);
    } catch (error) {
      rescored.push({
        ...record,
        status: "error",
        error: scoringError(error),
      });
    }
  }
  return {
    records: rescored,
    summary: buildEvalSummary(
      suite.id,
      variantIds,
      suite.scenarios.map((scenario) => scenario.id),
      rescored,
    ),
  };
}

export async function rescoreEvalBundle(directoryInput: string): Promise<RescoreResult> {
  const directory = resolve(directoryInput);
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  ) as StoredManifest;
  if (manifest.schemaVersion !== 1) {
    throw new Error(`unsupported eval artifact schema ${manifest.schemaVersion}`);
  }
  const suiteId = manifest.plan.suiteId;
  if (!isEvalSuiteId(suiteId)) {
    throw new Error(`artifact references unavailable suite ${JSON.stringify(suiteId)}`);
  }
  const rawRecords = await readFile(join(directory, "runs.jsonl"), "utf8");
  const records = rawRecords
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvalRunRecord);
  const variantIds = manifest.plan.variants.map((variant) => variant.id);
  const suite: EvalSuite<AgentEvalScenario> = evalSuites[suiteId];
  const result = await rescoreEvalRecords(suite, variantIds, records);
  const recordsPath = join(directory, "rescored-runs.jsonl");
  const summaryPath = join(directory, "rescored-summary.json");
  const reportPath = join(directory, "rescored-report.md");
  await Promise.all([
    writeFile(
      recordsPath,
      `${result.records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    ),
    writeFile(summaryPath, `${JSON.stringify(result.summary, null, 2)}\n`, "utf8"),
    writeFile(reportPath, formatEvalReport(result.summary), "utf8"),
  ]);
  return { ...result, recordsPath, summaryPath, reportPath };
}
