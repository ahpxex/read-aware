import type { ThreadChunk } from "../chunks";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type EvalCheckCategory =
  | "answer"
  | "tool"
  | "interaction"
  | "state"
  | "policy"
  | "quality";

export interface EvalCheck {
  id: string;
  category: EvalCheckCategory;
  passed: boolean;
  message: string;
  expected?: JsonValue;
  actual?: JsonValue;
  /** Relative contribution to the numeric score; pass/fail still requires every check. */
  weight?: number;
}

export interface EvalAssessment {
  passed: boolean;
  /** Normalized to the inclusive 0..1 range. */
  score: number;
  checks: EvalCheck[];
}

export interface EvalTokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface EvalTelemetry {
  /** Full harness wall time, including tools and local orchestration. */
  wallTimeMs: number;
  /** Sum of model round-trip durations when the runtime reports them. */
  modelTimeMs?: number;
  meanTtfbMs?: number;
  rounds?: number;
  tokens?: EvalTokenUsage;
  costUsd?: number;
}

export interface CapturedModelRequest {
  turn: number;
  round: number;
  model: {
    provider: string;
    id: string;
    api: string;
  };
  context: JsonObject;
  options: JsonObject;
}

export interface EvalToolCall {
  turn: number;
  id: string;
  name: string;
  args?: JsonValue;
  output?: string;
  isError?: boolean;
}

export interface EvalInteraction {
  turn: number;
  phase: "request" | "response";
  kind?: "question" | "permission";
  id: string;
  value: JsonValue;
}

export interface AgentEvalTurnObservation {
  turn: number;
  input: JsonObject;
  answer: string;
  thinking: string;
  chunks: ThreadChunk[];
}

export interface AgentEvalObservation {
  turns: AgentEvalTurnObservation[];
  /** Convenience alias for the final turn's answer. */
  answer: string;
  thinking: string;
  tools: EvalToolCall[];
  interactions: EvalInteraction[];
  modelRequests: CapturedModelRequest[];
  telemetry: EvalTelemetry;
  state?: JsonValue;
}

export interface EvalScenario<TObservation> {
  id: string;
  description: string;
  tags?: string[];
  /** Stable, secret-free scenario definition written into run artifacts. */
  input: JsonValue;
  evaluate: (observation: TObservation) => EvalAssessment | Promise<EvalAssessment>;
}

export interface EvalHarnessContext {
  repetition: number;
  signal: AbortSignal;
}

export interface EvalHarnessOutput<TObservation> {
  observation: TObservation;
  telemetry?: EvalTelemetry;
}

export interface EvalVariant<TScenario, TObservation> {
  id: string;
  description?: string;
  metadata: JsonObject;
  run: (
    scenario: TScenario,
    context: EvalHarnessContext,
  ) => Promise<EvalHarnessOutput<TObservation>>;
}

export interface EvalSuite<TScenario> {
  id: string;
  /**
   * 稳定短编号（S01…），做人与 agent 之间的引用坐标（"S07.3 挂了"）。
   * 只增不改：新套件顺延编号，永不复用旧号。
   */
  code: string;
  description: string;
  scenarios: TScenario[];
}

export type EvalRunStatus = "passed" | "failed" | "error";
export type EvalErrorStage = "setup" | "execution" | "scoring" | "timeout";

export interface EvalRunError {
  stage: EvalErrorStage;
  name: string;
  message: string;
  stack?: string;
  cause?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface EvalRunRecord {
  id: string;
  suiteId: string;
  scenarioId: string;
  variantId: string;
  repetition: number;
  executionIndex: number;
  status: EvalRunStatus;
  startedAt: string;
  finishedAt: string;
  input: JsonValue;
  output?: JsonValue;
  assessment?: EvalAssessment;
  telemetry: EvalTelemetry;
  error?: EvalRunError;
}

export interface EvalAggregate {
  variantId: string;
  scenarioId?: string;
  runs: number;
  passed: number;
  failed: number;
  errors: number;
  passRate: number;
  meanScore: number;
  telemetry: {
    meanWallTimeMs?: number;
    meanModelTimeMs?: number;
    meanTtfbMs?: number;
    meanRounds?: number;
    meanTokens?: EvalTokenUsage;
    meanCostUsd?: number;
  };
}

export interface EvalComparison {
  baselineVariantId: string;
  candidateVariantId: string;
  pairedRuns: number;
  passRateDelta: number;
  meanScoreDelta: number;
  telemetryDelta: {
    meanWallTimeMs?: number;
    meanModelTimeMs?: number;
    meanTtfbMs?: number;
    meanRounds?: number;
    meanTokens?: EvalTokenUsage;
    meanCostUsd?: number;
  };
}

export interface EvalSummary {
  suiteId: string;
  baselineVariantId: string;
  generatedAt: string;
  runs: number;
  passed: number;
  failed: number;
  errors: number;
  byVariant: EvalAggregate[];
  byScenario: EvalAggregate[];
  comparisons: EvalComparison[];
}

export interface EvalRunPlan {
  suiteId: string;
  suiteDescription: string;
  repetitions: number;
  timeoutMs: number;
  scenarios: Array<{ id: string; description: string; tags: string[] }>;
  variants: Array<{ id: string; description?: string; metadata: JsonObject }>;
}

export interface EvalRunHooks {
  onPlan?: (plan: EvalRunPlan) => void | Promise<void>;
  onRunComplete?: (record: EvalRunRecord) => void | Promise<void>;
  onComplete?: (summary: EvalSummary) => void | Promise<void>;
}

export class EvalStageError extends Error {
  readonly stage: Exclude<EvalErrorStage, "timeout" | "scoring">;
  override readonly cause?: unknown;

  constructor(
    stage: Exclude<EvalErrorStage, "timeout" | "scoring">,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "EvalStageError";
    this.stage = stage;
    this.cause = cause;
  }
}
