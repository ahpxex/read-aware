export const REVIEW_DIMENSIONS = [
  { id: "correctness", label: "正确可信" },
  { id: "completeness", label: "回答完整" },
  { id: "helpfulness", label: "阅读帮助" },
  { id: "restraint", label: "表达分寸" },
] as const;

export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number]["id"];
export type HumanVerdict = "pass" | "partial" | "fail";

export const REVIEW_FLAGS = [
  "事实错误",
  "缺少依据",
  "章节或进度错误",
  "剧透问题",
  "没有答完",
  "过度展开",
  "操作未兑现",
] as const;

export type ReviewFlag = (typeof REVIEW_FLAGS)[number];

export interface HumanReview {
  targetId: string;
  verdict?: HumanVerdict;
  dimensions: Partial<Record<ReviewDimension, number>>;
  flags: ReviewFlag[];
  notes: string;
  updatedAt: string;
}

export interface HumanReviewInput {
  targetId: string;
  verdict?: HumanVerdict;
  dimensions?: Partial<Record<ReviewDimension, number>>;
  flags?: ReviewFlag[];
  notes?: string;
}

export interface ManualReviewTurn {
  id: string;
  question: string;
  answer: string;
  tools: Array<{ name: string; args?: unknown; output?: string; isError?: boolean }>;
  interactions: Array<{ phase: string; kind?: string; value?: unknown }>;
  telemetry: {
    wallTimeMs: number;
    rounds?: number;
    costUsd?: number;
    tokens?: { total: number };
  };
  createdAt: string;
}

export interface ManualReviewSession {
  id: string;
  runId: string;
  scenarioId: string;
  variantId: string;
  createdAt: string;
  model: { provider: string; id: string; thinkingLevel: string };
  inheritSelection: boolean;
  turns: ManualReviewTurn[];
  active?: boolean;
}

export interface CreateManualSessionInput {
  scenarioId: string;
  variantId: string;
  inheritSelection: boolean;
}

export interface AskManualSessionInput {
  question: string;
}

const DIMENSION_IDS = new Set<string>(REVIEW_DIMENSIONS.map((entry) => entry.id));
const FLAG_IDS = new Set<string>(REVIEW_FLAGS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeHumanReviewInput(value: unknown): HumanReviewInput {
  if (!isRecord(value) || typeof value.targetId !== "string" || !value.targetId.trim()) {
    throw new Error("review targetId is required");
  }
  const verdict = value.verdict;
  if (verdict !== undefined && verdict !== "pass" && verdict !== "partial" && verdict !== "fail") {
    throw new Error("review verdict must be pass, partial, or fail");
  }
  const dimensions: Partial<Record<ReviewDimension, number>> = {};
  if (value.dimensions !== undefined) {
    if (!isRecord(value.dimensions)) throw new Error("review dimensions must be an object");
    for (const [key, score] of Object.entries(value.dimensions)) {
      if (!DIMENSION_IDS.has(key) || typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5) {
        throw new Error(`invalid review dimension ${key}`);
      }
      dimensions[key as ReviewDimension] = score;
    }
  }
  const rawFlags = value.flags ?? [];
  if (!Array.isArray(rawFlags) || rawFlags.some((flag) => typeof flag !== "string" || !FLAG_IDS.has(flag))) {
    throw new Error("review flags contain an unknown value");
  }
  const notes = value.notes ?? "";
  if (typeof notes !== "string" || notes.length > 20_000) {
    throw new Error("review notes must be at most 20000 characters");
  }
  return {
    targetId: value.targetId.trim(),
    ...(verdict === undefined ? {} : { verdict }),
    dimensions,
    flags: [...new Set(rawFlags)] as ReviewFlag[],
    notes,
  };
}

export function reviewMean(review: HumanReview | undefined): number | undefined {
  if (!review) return undefined;
  const scores = Object.values(review.dimensions);
  if (scores.length === 0) return undefined;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

