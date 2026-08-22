/** viewer 的数据类型与取数（与 vite 中间件的 /api/* 对应）。 */

import type {
  AskManualSessionInput,
  CreateManualSessionInput,
  HumanReview,
  HumanReviewInput,
  ManualReviewSession,
  ManualReviewTurn,
} from "./reviews";

export interface CatalogScenario {
  /** 稳定引用坐标，如 "S07.3"。 */
  ref: string;
  id: string;
  description: string;
  tags: string[];
  /** defineAgentEvalScenario 序列化的场景定义（scope/seed 摘要/turns/expectation/criteria/rubric）。 */
  input: {
    scope?: unknown;
    seed?: unknown;
    turns?: Array<{ text?: string; attachments?: Array<{ text: string }>; readingCursor?: unknown }>;
    expectation?: unknown;
    rubric?: string[];
    criteria?: unknown;
  };
}

export interface CatalogSuite {
  id: string;
  displayName: string;
  code: string;
  /** 所属组：behavior（能力套件）/ realbook（真书套件）。 */
  group: "behavior" | "realbook";
  description: string;
  scenarios: CatalogScenario[];
}

export interface RunListing {
  runId: string;
  suiteId: string;
  /** running = 正在写入；stale = 十分钟无写入的未完成 run（大概率被杀）。 */
  status: "running" | "stale" | "complete";
  /** 计划内总 run 数——进行中 run 的进度分母。 */
  total?: number;
  generatedAt?: string;
  runs?: number;
  passed?: number;
  failed?: number;
  errors?: number;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  repetitions?: number;
}

export interface EvalCheck {
  id: string;
  category: string;
  passed: boolean;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface RunRecord {
  id: string;
  scenarioId: string;
  variantId: string;
  repetition: number;
  status: "passed" | "failed" | "error";
  assessment?: { passed: boolean; score: number; checks: EvalCheck[] };
  telemetry: {
    wallTimeMs: number;
    rounds?: number;
    costUsd?: number;
    tokens?: { total: number };
  };
  output?: {
    turns?: Array<{
      input?: {
        text?: string;
        attachments?: Array<{ text?: string }>;
        readingCursor?: {
          chapterIndex?: number;
          chapterTitle?: string;
          bookProgress?: number;
          chapterProgress?: number;
          visibleText?: string;
        };
      };
      answer?: string;
    }>;
    tools?: Array<{ turn?: number; name: string; args?: unknown; output?: string; isError?: boolean }>;
  };
  error?: { stage: string; name: string; message: string };
}

export interface RunDetail {
  status?: "running" | "stale" | "complete";
  manifest?: {
    runId?: string;
    git?: { commit?: string; branch?: string; dirty?: boolean };
    plan?: {
      suiteId?: string;
      suiteDisplayName?: string;
      repetitions?: number;
      variants?: Array<{ id: string; metadata?: Record<string, unknown> }>;
    };
  };
  summary?: {
    suiteId: string;
    suiteDisplayName?: string;
    generatedAt: string;
    runs: number;
    passed: number;
    failed: number;
    errors: number;
    byScenario: Array<{
      variantId?: string;
      scenarioId?: string;
      runs: number;
      passed: number;
      meanScore: number;
      telemetry: { meanWallTimeMs?: number; meanRounds?: number; meanCostUsd?: number };
    }>;
    comparisons: Array<{
      candidateVariantId: string;
      pairedRuns: number;
      passRateDelta: number;
      meanScoreDelta: number;
    }>;
  };
  records: RunRecord[];
  humanReviews?: Record<string, HumanReview>;
  manualSessions?: ManualReviewSession[];
  selectedRescore?: string;
  rescores?: Array<{
    id: string;
    createdAt?: string;
    compatibility?: { comparable?: boolean };
  }>;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} → ${response.status}`);
  return (await response.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `${path} → ${response.status}`);
  return value;
}

export interface AttentionItem {
  suiteId: string;
  runId: string;
  scenarioId: string;
  status: string;
  failedChecks: Array<{ id: string; message: string }>;
}

export const fetchAttention = () => get<AttentionItem[]>("/api/attention");

/**
 * 订阅工件目录的写入直播（SSE）：任何 bundle 变化（新 run、逐场景落盘、
 * summary 完成）触发 onChange——调用方借此重拉当前页数据。返回退订函数。
 */
export function subscribeRunEvents(onChange: () => void): () => void {
  const source = new EventSource("/api/events");
  source.onmessage = (event) => {
    if (event.data !== "connected") onChange();
  };
  return () => source.close();
}
export const fetchCatalog = () => get<CatalogSuite[]>("/api/catalog");
export const fetchRuns = () => get<RunListing[]>("/api/runs");
export const fetchRun = (runId: string, rescoreId?: string) =>
  get<RunDetail>(
    `/api/runs/${encodeURIComponent(runId)}${rescoreId ? `?rescore=${encodeURIComponent(rescoreId)}` : ""}`,
  );

export const saveHumanReview = (runId: string, review: HumanReviewInput) =>
  post<HumanReview>(`/api/runs/${encodeURIComponent(runId)}/human-reviews`, review);

export const createManualSession = (runId: string, input: CreateManualSessionInput) =>
  post<ManualReviewSession>(`/api/runs/${encodeURIComponent(runId)}/manual-sessions`, input);

export const askManualSession = (sessionId: string, input: AskManualSessionInput) =>
  post<ManualReviewTurn>(`/api/manual-sessions/${encodeURIComponent(sessionId)}/turns`, input);

export function ms(value: number | undefined): string {
  if (value === undefined) return "—";
  return value >= 10_000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

export function usd(value: number | undefined): string {
  if (value === undefined || value === 0) return "—";
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

/** 场景对话语言（元信息中文、测试语言多样——这个徽标让语言覆盖一目了然）。 */
export function turnsLanguage(turns: Array<{ text?: string }> | undefined): "中文" | "EN" | "—" {
  const text = (turns ?? []).map((turn) => turn.text ?? "").join("");
  if (!text) return "—";
  return /[一-鿿]/.test(text) ? "中文" : "EN";
}
