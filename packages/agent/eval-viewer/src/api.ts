/** viewer 的数据类型与取数（与 vite 中间件的 /api/* 对应）。 */

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
  code: string;
  description: string;
  scenarios: CatalogScenario[];
}

export interface RunListing {
  runId: string;
  suiteId: string;
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
    turns?: Array<{ input?: { text?: string }; answer?: string }>;
    tools?: Array<{ name: string; args?: unknown; output?: string; isError?: boolean }>;
  };
  error?: { stage: string; name: string; message: string };
}

export interface RunDetail {
  manifest?: {
    runId?: string;
    git?: { commit?: string; branch?: string; dirty?: boolean };
    plan?: {
      repetitions?: number;
      variants?: Array<{ id: string; metadata?: Record<string, unknown> }>;
    };
  };
  summary?: {
    suiteId: string;
    generatedAt: string;
    runs: number;
    passed: number;
    failed: number;
    errors: number;
    byScenario: Array<{
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
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} → ${response.status}`);
  return (await response.json()) as T;
}

export interface AttentionItem {
  suiteId: string;
  runId: string;
  scenarioId: string;
  status: string;
  failedChecks: Array<{ id: string; message: string }>;
}

export const fetchAttention = () => get<AttentionItem[]>("/api/attention");
export const fetchCatalog = () => get<CatalogSuite[]>("/api/catalog");
export const fetchRuns = () => get<RunListing[]>("/api/runs");
export const fetchRun = (runId: string) => get<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`);

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
