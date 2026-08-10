/**
 * LLM judge：对带 rubric 的场景追加 quality 类语义打分。
 * 确定性断言仍是第一道闸（见 assertions.ts）；judge 只补确定性表达不了的
 * 维度——回答质量、单位是否人话、语气详略。verdict 走严格 JSON，解析失败
 * 重试一次后抛错（落成 scoring 错误，永远不会被静默当作通过）。
 */
import { assessmentFromChecks, combineAssessments } from "./assertions";
import type { AgentEvalScenario } from "./agent-harness";
import type { EvalAssessment, EvalCheck, JsonValue } from "./types";

/** 单次非流式补全；生产由 CLI 构造，测试注入假实现。 */
export type JudgeCompletion = (prompt: string) => Promise<string>;

export interface AgentEvalJudgeOptions {
  complete: JudgeCompletion;
  /** criterion score >= threshold 记为通过（默认 0.6）。 */
  threshold?: number;
}

export interface JudgeObservationDigest {
  userTurns: string[];
  answer: string;
  tools: Array<{ name: string; args?: string }>;
}

interface JudgeVerdict {
  criterion: string;
  score: number;
  rationale: string;
}

const MAX_ARGS_CHARS = 200;
const MAX_ANSWER_CHARS = 6_000;

/**
 * rescore 路径拿到的是 JSON 反序列化后的 observation（JsonValue），
 * 不是运行期的类型化对象——摘取时对形状保持宽容。
 */
export function digestObservation(observation: unknown): JudgeObservationDigest {
  const record =
    observation && typeof observation === "object" && !Array.isArray(observation)
      ? (observation as Record<string, unknown>)
      : {};
  const answer = typeof record.answer === "string" ? record.answer : "";
  const turns = Array.isArray(record.turns) ? record.turns : [];
  const userTurns = turns.flatMap((turn) => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) return [];
    const input = (turn as Record<string, unknown>).input;
    if (!input || typeof input !== "object" || Array.isArray(input)) return [];
    const text = (input as Record<string, unknown>).text;
    return typeof text === "string" ? [text] : [];
  });
  const tools = (Array.isArray(record.tools) ? record.tools : []).flatMap((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return [];
    const entry = tool as Record<string, unknown>;
    if (typeof entry.name !== "string") return [];
    const args =
      entry.args === undefined ? undefined : JSON.stringify(entry.args).slice(0, MAX_ARGS_CHARS);
    return [{ name: entry.name, ...(args === undefined ? {} : { args }) }];
  });
  return { userTurns, answer: answer.slice(0, MAX_ANSWER_CHARS), tools };
}

export function buildJudgePrompt(input: {
  description: string;
  rubric: string[];
  digest: JudgeObservationDigest;
}): string {
  const turns = input.digest.userTurns.map((text, index) => `${index + 1}. ${text}`).join("\n");
  const tools =
    input.digest.tools
      .map((tool) => `- ${tool.name}${tool.args ? ` ${tool.args}` : ""}`)
      .join("\n") || "- (none)";
  const criteria = input.rubric.map((entry, index) => `${index + 1}. ${entry}`).join("\n");
  return `You are grading one recorded run of a reading-assistant agent.

Scenario: ${input.description}

User turns:
${turns || "1. (empty)"}

Tools the agent called:
${tools}

Final answer:
"""
${input.digest.answer || "(empty answer)"}
"""

Grade the final answer against each criterion below. Judge only what is in this transcript; do not reward promises about future work.

Criteria:
${criteria}

Reply with STRICT JSON only — no markdown fences, no prose:
{"criteria":[{"criterion":"<criterion text verbatim>","score":<number 0..1>,"rationale":"<one short sentence>"}]}
Score 1 = fully satisfied, 0 = clearly violated, in between = partially satisfied. Return exactly ${input.rubric.length} entries in the same order.`;
}

function parseVerdicts(raw: string, rubric: string[]): JudgeVerdict[] | undefined {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const criteria = (parsed as { criteria?: unknown }).criteria;
  if (!Array.isArray(criteria) || criteria.length !== rubric.length) return undefined;
  const verdicts: JudgeVerdict[] = [];
  for (const [index, entry] of criteria.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const { score, rationale } = entry as { score?: unknown; rationale?: unknown };
    if (typeof score !== "number" || score < 0 || score > 1) return undefined;
    verdicts.push({
      criterion: rubric[index]!,
      score,
      rationale: typeof rationale === "string" ? rationale : "",
    });
  }
  return verdicts;
}

export class AgentEvalJudge {
  private readonly complete: JudgeCompletion;
  private readonly threshold: number;

  constructor(options: AgentEvalJudgeOptions) {
    this.complete = options.complete;
    this.threshold = options.threshold ?? 0.6;
  }

  async assess(input: {
    description: string;
    rubric: string[];
    observation: unknown;
  }): Promise<EvalAssessment> {
    const prompt = buildJudgePrompt({
      description: input.description,
      rubric: input.rubric,
      digest: digestObservation(input.observation),
    });
    let verdicts = parseVerdicts(await this.complete(prompt), input.rubric);
    if (!verdicts) verdicts = parseVerdicts(await this.complete(prompt), input.rubric);
    if (!verdicts) throw new Error("judge did not return a parseable verdict");
    const checks: EvalCheck[] = verdicts.map((verdict, index) => ({
      id: `quality.judge.${index}`,
      category: "quality",
      passed: verdict.score >= this.threshold,
      message: verdict.rationale || verdict.criterion,
      expected: verdict.criterion,
      actual: verdict.score as JsonValue,
    }));
    return assessmentFromChecks(checks);
  }
}

/**
 * 全局质量 rubric：结构达标 ≠ 回答好。judge 开启时每个场景（不只带自定义
 * rubric 的）都按这两条评非结构化质量——直接性与文风详略。
 */
export const GLOBAL_QUALITY_RUBRIC = [
  "The answer directly addresses what the reader asked, with no filler, no restating of the question, and no unnecessary hedging or meta-commentary about tools",
  "The prose reads like a thoughtful reading companion: concrete, well-organized, and no longer than the ask warrants",
];

/** judge 套在每个场景上：自定义 rubric（若有）+ 全局质量 rubric，与确定性断言合并。 */
export function withJudge(
  scenario: AgentEvalScenario,
  judge: AgentEvalJudge,
): AgentEvalScenario {
  const rubric = [...(scenario.rubric ?? []), ...GLOBAL_QUALITY_RUBRIC];
  const base = scenario.evaluate;
  return {
    ...scenario,
    evaluate: async (observation) =>
      combineAssessments(
        await base(observation),
        await judge.assess({ description: scenario.description, rubric, observation }),
      ),
  };
}
