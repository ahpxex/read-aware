import { parseArgs } from "node:util";
import { resolve } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { accountCredential } from "../models/accounts";
import { buildProviderRegistry } from "../models/registry";
import { createAgentEvalVariant } from "./agent-harness";
import { EvalArtifactStore } from "./artifacts";
import { AgentEvalJudge, withJudge } from "./judge";
import { resolveEvalModel, resolveJudgeCompletion } from "./model-config";
import { formatEvalReport, formatRunFailures, formatRunLine } from "./report";
import { runEvalSuite } from "./runner";
import { evalSuites, isEvalSuiteId, type EvalSuiteId } from "./suites";
import { compareTrends, loadTrend, saveTrend, trendFromSummary, trendPath } from "./trend";
import type { EvalRunRecord, EvalVariant } from "./types";
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
  suiteId: EvalSuiteId;
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
  bun run eval:agent [suite] [provider] [model] [options]
  bun run eval:reading [provider] [model] [options]

Options:
  --provider <id>              Baseline provider (default: deepseek)
  --model <id>                 Baseline model (default: provider reasoning model)
  --baseline-name <name>       Stable baseline variant id (default: baseline)
  --candidate-model <id>       Compare another model from the baseline provider
  --candidate <spec>           Compare name=provider:model (repeatable)
  --repetitions <n>            Runs per scenario and variant (default: 1)
  --concurrency <n>            Parallel (scenario, repetition) units (default: 1)
  --timeout-ms <ms>            Per-run timeout (default: 120000)
  --scenario <id[,id]>         Run selected scenarios (repeatable)
  --tag <tag[,tag]>            Run scenarios matching any selected tag
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
  if (!isEvalSuiteId(suiteInput)) {
    throw new Error(
      `unknown eval suite ${JSON.stringify(suiteInput)}; available: ${Object.keys(evalSuites).join(", ")}`,
    );
  }
  const provider = parsed.values.provider ?? positionals.shift() ?? "deepseek";
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
    timeoutMs: integer(parsed.values["timeout-ms"], 120_000, "timeout-ms"),
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

function selectScenarios(options: EvalCliOptions): AgentEvalScenario[] {
  const suite = evalSuites[options.suiteId];
  const known = new Set(suite.scenarios.map((scenario) => scenario.id));
  const unknown = options.scenarioIds.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`unknown scenarios: ${unknown.join(", ")}`);
  return suite.scenarios.filter(
    (scenario) =>
      (options.scenarioIds.length === 0 || options.scenarioIds.includes(scenario.id)) &&
      (options.tags.length === 0 || scenario.tags?.some((tag) => options.tags.includes(tag))),
  );
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
  const registry = buildProviderRegistry();
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
  const scenarios = selectScenarios(options);
  if (scenarios.length === 0) throw new Error("no eval scenarios matched the selected filters");
  if (options.list) {
    for (const scenario of scenarios) {
      console.log(`${scenario.id}\t${scenario.tags?.join(",") ?? ""}\t${scenario.description}`);
    }
    return;
  }

  let judgeSecret: string | undefined;
  let scoredScenarios = scenarios;
  if (options.judge) {
    const judgeCompletion = resolveJudgeCompletion(
      options.judgeProvider ?? options.provider,
      options.judgeModel,
    );
    judgeSecret = judgeCompletion.secret;
    const judge = new AgentEvalJudge({ complete: judgeCompletion.complete });
    scoredScenarios = scenarios.map((scenario) => withJudge(scenario, judge));
    const judged = scenarios.filter((scenario) => scenario.rubric?.length).length;
    console.log(
      `Judge: ${judgeCompletion.metadata.provider}:${judgeCompletion.metadata.model} scoring ${judged}/${scenarios.length} scenarios with rubrics`,
    );
  }

  const suite = { ...evalSuites[options.suiteId], scenarios: scoredScenarios };
  const specs: CandidateSpec[] = [
    { id: options.baselineName, provider: options.provider, model: options.model },
    ...options.candidates,
  ];
  const built = specs.map((spec) => buildVariant(spec, options.thinkingLevel));
  const variants = built.map((entry) => entry.variant);
  const artifactStore = options.artifacts
    ? await EvalArtifactStore.create({
        suiteId: suite.id,
        rootDir: options.outputDir,
        secrets: [...built.map((entry) => entry.secret), ...(judgeSecret ? [judgeSecret] : [])],
      })
    : undefined;

  const result = await runEvalSuite(suite, variants, {
    repetitions: options.repetitions,
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
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

  // 基线趋势：对比上一次同套件的按场景成绩，劣化行以 "!" 标出
  if (options.artifacts) {
    const baselineModel = `${specs[0]!.provider}:${specs[0]!.model ?? "default"}`;
    const currentTrend = trendFromSummary(result.summary, baselineModel, options.thinkingLevel);
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
