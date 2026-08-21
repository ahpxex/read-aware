import { parseArgs } from "node:util";
import { resolve } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { accountCredential } from "../models/accounts";
import { evalProviderRegistry } from "./model-config";
import { createAgentEvalVariant } from "./agent-harness";
import { EvalArtifactStore } from "./artifacts";
import { AgentEvalJudge, JUDGE_IMPLEMENTATION_VERSION, withJudge } from "./judge";
import { resolveEvalModel, resolveJudgeCompletion } from "./model-config";
import { formatEvalReport, formatRunFailures, formatRunLine } from "./report";
import { runEvalSuite } from "./runner";
import {
  evalSuites,
  evalSuiteGroups,
  isEvalSuiteGroupId,
  isEvalSuiteId,
  suiteIdsOfGroup,
  type EvalSuiteGroupId,
  type EvalSuiteId,
} from "./suites";
import { compareTrends, loadTrend, saveTrend, trendFromSummary, trendPath } from "./trend";
import type { EvalRunRecord, EvalVariant, JsonObject } from "./types";
import type { AgentEvalObservation } from "./types";
import type { AgentEvalScenario } from "./agent-harness";

const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

interface CandidateSpec {
  id: string;
  provider: string;
  model?: string;
}

export interface EvalCliOptions {
  /** 套件 id 或组选择器（behavior / realbook）。 */
  suiteId: EvalSuiteId | EvalSuiteGroupId;
  provider: string;
  model?: string;
  baselineName: string;
  candidates: CandidateSpec[];
  repetitions: number;
  concurrency: number;
  timeoutMs: number;
  scenarioIds: string[];
  tags: string[];
  thinkingLevel: ThinkingLevel;
  judge: boolean;
  judgeProvider?: string;
  judgeModel?: string;
  outputDir?: string;
  artifacts: boolean;
  gate: boolean;
  verbose: boolean;
  list: boolean;
  help: boolean;
}

function usage(): string {
  return `ReadAware agent evaluations

Usage:
  bun run eval:agent [suite|group] [provider] [model] [options]
  bun run eval:reading [provider] [model] [options]

Targets:
  <suite>                      A single suite id (e.g. reading, karamazov)
  behavior                     All capability suites on synthetic fixtures
  realbook                     All per-book suites + the real-book grid

Options:
  --provider <id>              Baseline provider (default: openrouter)
  --model <id>                 Baseline model (default: provider reasoning model)
  --baseline-name <name>       Stable baseline variant id (default: baseline)
  --candidate-model <id>       Compare another model from the baseline provider
  --candidate <spec>           Compare name=provider:model (repeatable)
  --repetitions <n>            Runs per scenario and variant (default: 1)
  --concurrency <n>            Parallel (scenario, repetition) units (default: 1)
  --timeout-ms <ms>            Per-run timeout (default: 240000)
  --scenario <id[,id]>         Run selected scenarios (repeatable)
  --tag <tag[,tag]>            Run scenarios matching any selected tag (closed
                               vocabulary, see evals/tags.ts)
  --thinking <level>           off|minimal|low|medium|high|xhigh|max (default: medium)
  --judge                      Score rubric scenarios with an LLM judge (quality checks)
  --judge-provider <id>        Judge provider (default: baseline provider)
  --judge-model <id>           Judge model (default: provider default)
  --output-dir <path>          Artifact root (default: .eval)
  --no-artifacts               Do not persist prompts, traces, and reports
  --gate                       Exit nonzero on behavioral failures
  --verbose                    Print failed answers and tool traces
  --list                       List selected suite scenarios without calling a model
  --help                       Show this help

Custom providers use READAWARE_EVAL_BASE_URL, READAWARE_EVAL_API_KEY,
READAWARE_EVAL_MODEL, and optionally READAWARE_EVAL_API.`;
}

function integer(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function listValues(values: string[] | undefined): string[] {
  return (values ?? []).flatMap((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function parseThinkingLevel(value: string | undefined): ThinkingLevel {
  // medium 是产品默认档，也是回归基线该量的档位；off 只该在刻意省钱的
  // 快扫时显式传（跨档位的 trend 对比会被标 INCOMPARABLE）。
  const level = value ?? "medium";
  if (!THINKING_LEVELS.includes(level as ThinkingLevel)) {
    throw new Error(`invalid thinking level ${JSON.stringify(level)}`);
  }
  return level as ThinkingLevel;
}

function parseCandidate(value: string, index: number): CandidateSpec {
  const equals = value.indexOf("=");
  const id = equals < 0 ? `candidate-${index + 1}` : value.slice(0, equals).trim();
  const modelRef = (equals < 0 ? value : value.slice(equals + 1)).trim();
  const colon = modelRef.indexOf(":");
  if (!id || colon <= 0 || colon === modelRef.length - 1) {
    throw new Error(
      `invalid candidate ${JSON.stringify(value)}; expected name=provider:model`,
    );
  }
  return { id, provider: modelRef.slice(0, colon), model: modelRef.slice(colon + 1) };
}

export function parseEvalCliArgs(args: string[]): EvalCliOptions {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      provider: { type: "string" },
      model: { type: "string" },
      "baseline-name": { type: "string" },
      candidate: { type: "string", multiple: true },
      "candidate-model": { type: "string", multiple: true },
      repetitions: { type: "string" },
      concurrency: { type: "string" },
      "timeout-ms": { type: "string" },
      scenario: { type: "string", multiple: true },
      tag: { type: "string", multiple: true },
      thinking: { type: "string" },
      judge: { type: "boolean" },
      "judge-provider": { type: "string" },
      "judge-model": { type: "string" },
      "output-dir": { type: "string" },
      "no-artifacts": { type: "boolean" },
      gate: { type: "boolean" },
      verbose: { type: "boolean" },
      list: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const positionals = [...parsed.positionals];
  const suiteInput = positionals.shift() ?? "reading";
  if (!isEvalSuiteId(suiteInput) && !isEvalSuiteGroupId(suiteInput)) {
    throw new Error(
      `unknown eval suite ${JSON.stringify(suiteInput)}; available suites: ${Object.keys(evalSuites).join(", ")}; groups: ${Object.keys(evalSuiteGroups).join(", ")}`,
    );
  }
  const provider = parsed.values.provider ?? positionals.shift() ?? "openrouter";
  const model = parsed.values.model ?? positionals.shift();
  if (positionals.length > 0) {
    throw new Error(`unexpected positional arguments: ${positionals.join(" ")}`);
  }
  const directCandidates = (parsed.values.candidate ?? []).map(parseCandidate);
  const modelCandidates = (parsed.values["candidate-model"] ?? []).map((candidateModel, index) => ({
    id: `candidate-model-${index + 1}`,
    provider,
    model: candidateModel,
  }));
  return {
    suiteId: suiteInput,
    provider,
    model,
    baselineName: parsed.values["baseline-name"]?.trim() || "baseline",
    candidates: [...directCandidates, ...modelCandidates],
    repetitions: integer(parsed.values.repetitions, 1, "repetitions"),
    concurrency: integer(parsed.values.concurrency, 1, "concurrency"),
    // medium thinking 是缺省档：多书检索 + 深思考的场景 120s 会被误杀。
    timeoutMs: integer(parsed.values["timeout-ms"], 240_000, "timeout-ms"),
    scenarioIds: listValues(parsed.values.scenario),
    tags: listValues(parsed.values.tag),
    thinkingLevel: parseThinkingLevel(parsed.values.thinking),
    judge: parsed.values.judge === true,
    judgeProvider: parsed.values["judge-provider"],
    judgeModel: parsed.values["judge-model"],
    outputDir: parsed.values["output-dir"],
    artifacts: parsed.values["no-artifacts"] !== true,
    gate: parsed.values.gate === true,
    verbose: parsed.values.verbose === true,
    list: parsed.values.list === true,
    help: parsed.values.help === true,
  };
}

interface EvalTarget {
  suiteId: EvalSuiteId;
  scenarios: AgentEvalScenario[];
}
/** 把目标（套件或组）+ 过滤器解析为逐套件的待跑场景列表。 */
export function resolveEvalTargets(options: EvalCliOptions): EvalTarget[] {
  const suiteIds = isEvalSuiteGroupId(options.suiteId)
    ? suiteIdsOfGroup(options.suiteId)
    : [options.suiteId];
  // 未知场景 id 直接报错（拼写保护）：单套件对它自己的场景集，组对全组并集
  const union = new Set(suiteIds.flatMap((id) => evalSuites[id].scenarios.map((s) => s.id)));
  const unknown = options.scenarioIds.filter((id) => !union.has(id));
  if (unknown.length > 0) throw new Error(`unknown scenarios: ${unknown.join(", ")}`);
  const targets = suiteIds
    .map((suiteId) => {
      const suite = evalSuites[suiteId];
      const scenarios = suite.scenarios.filter(
        (scenario) =>
          (options.scenarioIds.length === 0 || options.scenarioIds.includes(scenario.id)) &&
          (options.tags.length === 0 || scenario.tags?.some((tag) => options.tags.includes(tag))),
      );
      return { suiteId, scenarios };
    })
    .filter((target) => target.scenarios.length > 0);
  if (targets.length === 0) throw new Error("no eval scenarios matched the selected filters");
  return targets;
}

function printVerboseRun(record: EvalRunRecord): void {
  if (record.status === "passed") return;
  const output = record.output;
  if (!output || Array.isArray(output) || typeof output !== "object") return;
  const answer = typeof output.answer === "string" ? output.answer.trim() : "";
  const tools = Array.isArray(output.tools)
    ? output.tools
        .flatMap((tool) =>
          tool && typeof tool === "object" && !Array.isArray(tool) && typeof tool.name === "string"
            ? [tool.name]
            : [],
        )
        .join(", ")
    : "";
  if (tools) console.log(`  tools: ${tools}`);
  if (answer) console.log(`  answer: ${answer.slice(0, 800)}`);
}

function buildVariant(
  spec: CandidateSpec,
  thinkingLevel: ThinkingLevel,
): { variant: EvalVariant<AgentEvalScenario, AgentEvalObservation>; secret: string } {
  const registry = evalProviderRegistry();
  const resolved = resolveEvalModel(registry, spec.provider, spec.model);
  return {
    variant: createAgentEvalVariant({
      id: spec.id,
      account: resolved.account,
      modelId: resolved.modelId,
      registry,
      thinkingLevel,
    }),
    secret: accountCredential(resolved.account),
  };
}

export async function runEvalCli(args: string[]): Promise<void> {
  const options = parseEvalCliArgs(args);
  if (options.help) {
    console.log(usage());
    return;
  }
  const targets = resolveEvalTargets(options);
  if (options.list) {
    // 组目标多一列套件 id，行才能全局无歧义地被 --scenario 引用
    const withSuite = isEvalSuiteGroupId(options.suiteId) || targets.length > 1;
    for (const target of targets) {
      for (const scenario of target.scenarios) {
        const prefix = withSuite ? `${target.suiteId}\t` : "";
        console.log(
          `${prefix}${scenario.id}\t${scenario.tags?.join(",") ?? ""}\t${scenario.description}`,
        );
      }
    }
    return;
  }

  // judge 与变体只建一次，跨套件复用（变体内部逐 run 自建 thread/deps）
  let judge: AgentEvalJudge | undefined;
  let judgeSecret: string | undefined;
  let judgeLabel = "";
  let judgeMetadata: JsonObject = { enabled: false };
  if (options.judge) {
    const judgeCompletion = resolveJudgeCompletion(
      options.judgeProvider ?? options.provider,
      options.judgeModel,
    );
    judgeSecret = judgeCompletion.secret;
    judgeLabel = `${judgeCompletion.metadata.provider}:${judgeCompletion.metadata.model}`;
    judgeMetadata = {
      enabled: true,
      provider: judgeCompletion.metadata.provider,
      model: judgeCompletion.metadata.model,
      threshold: 0.6,
      implementationVersion: JUDGE_IMPLEMENTATION_VERSION,
    };
    judge = new AgentEvalJudge({ complete: judgeCompletion.complete });
  }
  const specs: CandidateSpec[] = [
    { id: options.baselineName, provider: options.provider, model: options.model },
    ...options.candidates,
  ];
  const built = specs.map((spec) => buildVariant(spec, options.thinkingLevel));
  const variants = built.map((entry) => entry.variant);
  if (judge) {
    const judged = targets.reduce(
      (total, target) =>
        total + target.scenarios.filter((scenario) => scenario.rubric?.length).length,
      0,
    );
    const total = targets.reduce((sum, target) => sum + target.scenarios.length, 0);
    console.log(`Judge: ${judgeLabel} scoring ${judged}/${total} scenarios with rubrics`);
  }

  for (const [index, target] of targets.entries()) {
    if (targets.length > 1) console.log(`\n=== [${index + 1}/${targets.length}] suite ${target.suiteId}`);
    await runSuiteTarget(options, target, {
      variants,
      judge,
      judgeSecret,
      specSecrets: built.map((entry) => entry.secret),
      specs,
      judgeMetadata,
    });
  }
}

interface SuiteRunContext {
  variants: EvalVariant<AgentEvalScenario, AgentEvalObservation>[];
  judge?: AgentEvalJudge;
  judgeSecret?: string;
  specSecrets: string[];
  specs: CandidateSpec[];
  judgeMetadata: JsonObject;
}

async function runSuiteTarget(
  options: EvalCliOptions,
  target: EvalTarget,
  context: SuiteRunContext,
): Promise<void> {
  const { judge } = context;
  const scenarios = judge
    ? target.scenarios.map((scenario) => withJudge(scenario, judge))
    : target.scenarios;
  const suite = { ...evalSuites[target.suiteId], scenarios };
  const artifactStore = options.artifacts
    ? await EvalArtifactStore.create({
        suiteId: suite.id,
        rootDir: options.outputDir,
        secrets: [...context.specSecrets, ...(context.judgeSecret ? [context.judgeSecret] : [])],
      })
    : undefined;

  const result = await runEvalSuite(suite, context.variants, {
    repetitions: options.repetitions,
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
    definitionMetadata: { judge: context.judgeMetadata },
    hooks: {
      onPlan: async (plan) => {
        console.log(
          `Eval ${plan.suiteId}: ${plan.scenarios.length} scenarios x ${plan.variants.length} variants x ${plan.repetitions} repetitions`,
        );
        await artifactStore?.writePlan(plan);
      },
      onRunComplete: async (record) => {
        console.log(formatRunLine(record));
        for (const failure of formatRunFailures(record)) console.log(failure);
        if (options.verbose) printVerboseRun(record);
        await artifactStore?.writeRun(record);
      },
    },
  });
  const markdown = formatEvalReport(result.summary);
  await artifactStore?.writeSummary(result.summary, markdown);
  console.log(
    `\nSummary: ${result.summary.passed}/${result.summary.runs} passed, ${result.summary.failed} failed, ${result.summary.errors} errors`,
  );

  // 基线趋势只接受完整套件；筛选快扫不能把未运行的场景记成“移除”。
  const registeredScenarioIds = new Set(
    evalSuites[target.suiteId].scenarios.map((scenario) => scenario.id),
  );
  const completeSuiteRun =
    suite.scenarios.length === registeredScenarioIds.size &&
    suite.scenarios.every((scenario) => registeredScenarioIds.has(scenario.id));
  if (options.artifacts && completeSuiteRun) {
    const baselineModel = `${context.specs[0]!.provider}:${context.specs[0]!.model ?? "default"}`;
    const tags = new Map(suite.scenarios.map((scenario) => [scenario.id, scenario.tags ?? []]));
    const currentTrend = trendFromSummary(
      result.summary,
      baselineModel,
      options.thinkingLevel,
      tags,
    );
    const path = trendPath(resolve(options.outputDir ?? ".eval"), suite.id);
    const previous = await loadTrend(path);
    if (previous) {
      const delta = compareTrends(previous, currentTrend);
      if (delta.length > 0) {
        console.log(`Trend vs previous run (${previous.generatedAt}):`);
        for (const line of delta) console.log(line);
      } else {
        console.log("Trend: no per-scenario change vs previous run");
      }
    }
    await saveTrend(path, currentTrend);
  } else if (options.artifacts) {
    console.log("Trend: skipped for a filtered scenario run");
  }
  for (const comparison of result.summary.comparisons) {
    console.log(
      `${comparison.candidateVariantId} vs ${comparison.baselineVariantId}: pass-rate ${(comparison.passRateDelta * 100).toFixed(1)} pp, score ${comparison.meanScoreDelta >= 0 ? "+" : ""}${comparison.meanScoreDelta.toFixed(3)}`,
    );
  }
  if (artifactStore) console.log(`Artifacts: ${artifactStore.directory}`);

  if (result.summary.errors > 0 || (options.gate && result.summary.failed > 0)) {
    process.exitCode = 1;
  }
}
