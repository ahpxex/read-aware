import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { formatEvalReport } from "./report";
import { withJudge, type AgentEvalJudge } from "./judge";
import { buildEvalSummary } from "./summary";
import { collectEvalProvenance, type EvalArtifactProvenance } from "./artifacts";
import { fingerprintJson, fingerprintSuite } from "./fingerprint";
import { evalSuites, isEvalSuiteId } from "./suites";
import type { AgentEvalScenario } from "./agent-harness";
import type {
  EvalRunPlan,
  EvalRunRecord,
  EvalScenario,
  EvalSuite,
  EvalSummary,
  JsonObject,
  JsonValue,
} from "./types";

interface StoredManifest {
  schemaVersion: number;
  plan: EvalRunPlan;
  provenance?: EvalArtifactProvenance;
}

export interface RescoreCompatibility {
  scenarioInputs: boolean | "unknown";
  fixtureSources: boolean | "unknown";
  promptSources: boolean | "unknown";
  evaluatorSources: boolean | "unknown";
  comparable: boolean;
}

export interface RescoreResult {
  records: EvalRunRecord[];
  summary: EvalSummary;
  summaryPath?: string;
  reportPath?: string;
  recordsPath?: string;
  directory?: string;
  compatibility?: RescoreCompatibility;
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
  definitionHash?: string,
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
      new Map(suite.scenarios.map((scenario) => [scenario.id, scenario.tags ?? []])),
      definitionHash,
    ),
  };
}

export interface RescoreBundleOptions {
  /** 传入后，带 rubric 的场景在重打分时追加 quality checks —— 对历史 bundle 离线评审，不重跑被测模型。 */
  judge?: AgentEvalJudge;
  /** Provider/model/threshold metadata written beside this immutable rescore. */
  judgeMetadata?: JsonObject;
}

export async function rescoreEvalBundle(
  directoryInput: string,
  options: RescoreBundleOptions = {},
): Promise<RescoreResult> {
  const directory = resolve(directoryInput);
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  ) as StoredManifest;
  if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) {
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
  const registered: EvalSuite<AgentEvalScenario> = evalSuites[suiteId];
  const judge = options.judge;
  const suite: EvalSuite<AgentEvalScenario> = judge
    ? { ...registered, scenarios: registered.scenarios.map((s) => withJudge(s, judge)) }
    : registered;
  const definitionMetadata: JsonValue = options.judgeMetadata ?? {
    judge: judge ? "custom" : "none",
  };
  const definitionHash = fingerprintSuite(
    suite as unknown as EvalSuite<EvalScenario<unknown>>,
    definitionMetadata,
  );
  const currentPlan: EvalRunPlan = {
    ...manifest.plan,
    definitionHash,
    definitionMetadata,
    scenarios: suite.scenarios.map((scenario) => ({
      id: scenario.id,
      description: scenario.description,
      tags: scenario.tags ?? [],
      inputHash: fingerprintJson(scenario.input),
    })),
  };
  const currentProvenance = await collectEvalProvenance(directory, currentPlan);
  const originalInputs = new Map(
    manifest.plan.scenarios.map((scenario) => [scenario.id, scenario.inputHash]),
  );
  const hasOriginalInputHashes = [...originalInputs.values()].every(
    (hash) => typeof hash === "string" && hash.length > 0,
  );
  const scenarioInputs: RescoreCompatibility["scenarioInputs"] = hasOriginalInputHashes
    ? currentPlan.scenarios.every(
        (scenario) => originalInputs.get(scenario.id) === scenario.inputHash,
      )
    : "unknown";
  const compareSource = (
    key: "fixtureHash" | "promptHash" | "evaluatorHash",
  ): boolean | "unknown" =>
    manifest.provenance?.[key] === undefined
      ? "unknown"
      : manifest.provenance[key] === currentProvenance[key];
  const fixtureSources = compareSource("fixtureHash");
  const promptSources = compareSource("promptHash");
  const evaluatorSources = compareSource("evaluatorHash");
  const compatibility: RescoreCompatibility = {
    scenarioInputs,
    fixtureSources,
    promptSources,
    evaluatorSources,
    comparable:
      scenarioInputs === true &&
      fixtureSources === true &&
      promptSources === true &&
      evaluatorSources === true,
  };
  const result = await rescoreEvalRecords(suite, variantIds, records, definitionHash);
  const createdAt = new Date().toISOString();
  const rescoreId = `${createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${randomUUID().slice(0, 8)}`;
  const rescoreDirectory = join(directory, "rescored", rescoreId);
  await mkdir(rescoreDirectory, { recursive: true });
  const recordsPath = join(rescoreDirectory, "runs.jsonl");
  const summaryPath = join(rescoreDirectory, "summary.json");
  const reportPath = join(rescoreDirectory, "report.md");
  const rescoreManifestPath = join(rescoreDirectory, "manifest.json");
  await Promise.all([
    writeFile(
      recordsPath,
      `${result.records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    ),
    writeFile(summaryPath, `${JSON.stringify(result.summary, null, 2)}\n`, "utf8"),
    writeFile(reportPath, formatEvalReport(result.summary), "utf8"),
    writeFile(
      rescoreManifestPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          rescoreId,
          createdAt,
          sourceBundle: directory,
          sourceArtifactSchema: manifest.schemaVersion,
          sourceDefinitionHash: manifest.plan.definitionHash,
          definitionHash,
          definitionMetadata,
          compatibility,
          provenance: currentProvenance,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  ]);
  return {
    ...result,
    directory: rescoreDirectory,
    compatibility,
    recordsPath,
    summaryPath,
    reportPath,
  };
}
