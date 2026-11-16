import type { ThreadChunk } from "../chunks";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type EvalCheckCategory = "answer" | "tool" | "interaction" | "state" | "policy" | "quality";

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
  /** Optional automated semantic opinion, never folded into diagnostic checks/score. */
  modelReview?: {
    verdict: "pass" | "partial" | "fail";
    criteria: Array<{ criterion: string; score: number; rationale: string }>;
  };
  /** Diagnostic checks only; not a product-quality verdict. */
  passed: boolean;
  /** Diagnostic score. Normalized to the inclusive 0..1 range. */
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
  kind?: import("../ports").UserInteractionRequest["kind"];
  id: string;
  value: JsonValue;
}

export interface AgentEvalTurnObservation {
  stateBefore?: JsonValue;
  stateAfter?: JsonValue;
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
  /** Original fixture evidence for review, separate from what the tested model saw. */
  reviewEvidence?: JsonValue;
  /** The book pipeline this scenario ran on: the app's headless host, or the in-memory fixtures. */
  environment?: string;
  /**
   * Turns whose published answer is not the model's own: the runtime's answer
   * check rewrote it, or withheld it and sent the fallback instead.
   */
  interventions?: { turn: number; kind: "answer-rewritten" | "answer-withheld" }[];
}

export interface EvalScenario<TObservation> {
  id: string;
  description: string;
  tags?: string[];
  /** Stable, secret-free scenario definition written into run artifacts. */
  input: JsonValue;
  evaluate: (observation: TObservation, context?: { signal?: AbortSignal }) => EvalAssessment | Promise<EvalAssessment>;
}

export interface EvalHarnessContext {
  repetition: number;
  signal: AbortSignal;
  /** Diagnostic snapshot on execution failure only; never a completed observation. */
  capturePartial?: (snapshot: () => EvalHarnessOutput<unknown>) => void;
}

export interface EvalHarnessOutput<TObservation> {
  observation: TObservation;
  telemetry?: EvalTelemetry;
}

export interface EvalVariant<TScenario, TObservation> {
  id: string;
  description?: string;
  metadata: JsonObject;
  run: (scenario: TScenario, context: EvalHarnessContext) => Promise<EvalHarnessOutput<TObservation>>;
}

export interface EvalSuite<TScenario> {
  id: string;
  /** Human-readable name for navigation and reports; `id` remains the stable machine key. */
  displayName: string;
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
  /** The stable error code of the underlying failure, when it had one (e.g. `ai/provider`). */
  code?: string;
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
  /** Interrupted execution evidence. Not eligible for scoring or rescore. */
  partialOutput?: JsonValue;
  assessment?: EvalAssessment;
  telemetry: EvalTelemetry;
  error?: EvalRunError;
}

export interface EvalAggregate {
  variantId: string;
  scenarioId?: string;
  /** byTag 汇总行携带的能力标签。 */
  tag?: string;
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
  /** Primary review coverage; assertion-only historical results are pending. */
  quality?: import("./reviews").QualitySummary;
  manualQuality?: import("./reviews").QualitySummary;
  qualityByVariant?: Array<import("./reviews").QualitySummary & { variantId: string }>;
  suiteId: string;
  /** Optional for compatibility with summaries written before readable names. */
  suiteDisplayName?: string;
  /** Scenario inputs + evaluator implementation + scoring configuration. */
  definitionHash?: string;
  baselineVariantId: string;
  generatedAt: string;
  runs: number;
  passed: number;
  failed: number;
  errors: number;
  byVariant: EvalAggregate[];
  byScenario: EvalAggregate[];
  /** 能力标签维度的汇总（variant × tag）："测什么"的机器可读答案。 */
  byTag: EvalAggregate[];
  comparisons: EvalComparison[];
}

export interface EvalRunPlan {
  suiteId: string;
  /** Optional because run bundles written before display names remain readable. */
  suiteDisplayName?: string;
  definitionHash: string;
  definitionMetadata?: JsonValue;
  suiteDescription: string;
  repetitions: number;
  timeoutMs: number;
  scenarios: Array<{ id: string; description: string; tags: string[]; inputHash: string }>;
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

  constructor(stage: Exclude<EvalErrorStage, "timeout" | "scoring">, message: string, cause?: unknown) {
    super(message);
    this.name = "EvalStageError";
    this.stage = stage;
    this.cause = cause;
  }
}
