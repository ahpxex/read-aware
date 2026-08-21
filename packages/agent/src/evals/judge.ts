/**
 * LLM judge：对带 rubric 的场景追加 quality 类语义打分。
 * 确定性断言仍是第一道闸（见 assertions.ts）；judge 只补确定性表达不了的
 * 维度——回答质量、单位是否人话、语气详略。verdict 走严格 JSON，解析失败
 * 重试一次后抛错（落成 scoring 错误，永远不会被静默当作通过）。
 */
import { assessmentFromChecks, combineAssessments } from "./assertions";
import type { AgentEvalScenario } from "./agent-harness";
import type { EvalAssessment, EvalCheck, JsonValue } from "./types";

/** Bump whenever the judge-visible transcript or grading prompt semantics change. */
export const JUDGE_IMPLEMENTATION_VERSION = 2;

/** 单次非流式补全；生产由 CLI 构造，测试注入假实现。 */
export type JudgeCompletion = (
  prompt: string,
  options?: { signal?: AbortSignal },
) => Promise<string>;

export interface AgentEvalJudgeOptions {
  complete: JudgeCompletion;
  /** criterion score >= threshold 记为通过（默认 0.6）。 */
  threshold?: number;
}

export interface JudgeObservationDigest {
  userTurns: string[];
  turns: Array<{ user: string; assistant?: string }>;
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
  const rawTurns = Array.isArray(record.turns) ? record.turns : [];
  const turns = rawTurns.flatMap((turn) => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) return [];
    const entry = turn as Record<string, unknown>;
    const input = entry.input;
    if (!input || typeof input !== "object" || Array.isArray(input)) return [];
    const text = (input as Record<string, unknown>).text;
    if (typeof text !== "string") return [];
    return [
      {
        user: text,
        ...(typeof entry.answer === "string"
          ? { assistant: entry.answer.slice(0, MAX_ANSWER_CHARS) }
          : {}),
      },
    ];
  });
  const userTurns = turns.map((turn) => turn.user);
  const tools = (Array.isArray(record.tools) ? record.tools : []).flatMap((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return [];
    const entry = tool as Record<string, unknown>;
    if (typeof entry.name !== "string") return [];
    const args =
      entry.args === undefined ? undefined : JSON.stringify(entry.args).slice(0, MAX_ARGS_CHARS);
    return [{ name: entry.name, ...(args === undefined ? {} : { args }) }];
  });
  return { userTurns, turns, answer: answer.slice(0, MAX_ANSWER_CHARS), tools };
}

export function buildJudgePrompt(input: {
  description: string;
  rubric: string[];
  digest: JudgeObservationDigest;
}): string {
  const turns = input.digest.turns
    .map((turn, index) =>
      [
        `Turn ${index + 1} reader: ${turn.user}`,
        ...(turn.assistant === undefined
          ? []
          : [`Turn ${index + 1} assistant:\n\"\"\"\n${turn.assistant}\n\"\"\"`]),
      ].join("\n"),
    )
    .join("\n\n");
  const tools =
    input.digest.tools
      .map((tool) => `- ${tool.name}${tool.args ? ` ${tool.args}` : ""}`)
      .join("\n") || "- (none)";
  const criteria = input.rubric.map((entry, index) => `${index + 1}. ${entry}`).join("\n");
  return `You are grading one recorded run of a reading-assistant agent.

Scenario: ${input.description}

Recorded conversation:
${turns || "(empty)"}

Tools the agent called:
${tools}

Final answer:
"""
${input.digest.answer || "(empty answer)"}
"""

Grade the final answer against each criterion below. Judge only what is in this transcript; do not reward promises about future work.

Criteria:
${criteria}

Reply with STRICT JSON only — no markdown fences, no prose, do NOT repeat the criterion text:
{"criteria":[{"score":<number 0..1>,"rationale":"<one short sentence>"}]}
Score 1 = fully satisfied, 0 = clearly violated, in between = partially satisfied. Return exactly ${input.rubric.length} entries, in the same order as the criteria above.`;
}

function parseVerdicts(raw: string, rubric: string[]): JudgeVerdict[] | undefined {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // 模型偶尔把 JSON 包在散文里；取第一个 { 到最后一个 } 再试一次
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return undefined;
    try {
      parsed = JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const criteria = (parsed as { criteria?: unknown }).criteria;
  if (!Array.isArray(criteria) || criteria.length !== rubric.length) return undefined;
  // criterion 按序号对齐 rubric；回复里即便带了 criterion 字段也忽略（省 token 防截断）
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
    signal?: AbortSignal;
  }): Promise<EvalAssessment> {
    const prompt = buildJudgePrompt({
      description: input.description,
      rubric: input.rubric,
      digest: digestObservation(input.observation),
    });
    const first = await this.complete(prompt, { signal: input.signal });
    let verdicts = parseVerdicts(first, input.rubric);
    if (!verdicts) {
      // 重试带纠错反馈，而不是原样重发
      const corrective = `${prompt}\n\nYour previous reply could not be parsed as the required JSON:\n"""\n${first.slice(0, 400)}\n"""\nReply again with ONLY the JSON object described above — exactly ${input.rubric.length} criteria entries in order, no fences, no prose.`;
      const second = await this.complete(corrective, { signal: input.signal });
      verdicts = parseVerdicts(second, input.rubric);
      if (!verdicts) {
        throw new Error(
          `judge did not return a parseable verdict; last reply began: ${JSON.stringify(second.slice(0, 200))}`,
        );
      }
    }
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
    evaluate: async (observation, context) =>
      combineAssessments(
        await base(observation, context),
        await judge.assess({
          description: scenario.description,
          rubric,
          observation,
          signal: context?.signal,
        }),
      ),
  };
}
