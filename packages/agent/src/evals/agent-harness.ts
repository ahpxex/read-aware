import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
  Usage,
} from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { CompleteFn, StreamFn } from "../models/complete";
import { createStreamFn } from "../models/complete";
import type { LlmAccount } from "../models/accounts";
import { accountCredential, accountProviderId, createModelResolver } from "../models/accounts";
import { applyEvalRouting } from "./model-config";
import type { ProviderRegistry } from "../models/registry";
import type { ResolveModel } from "../models/roles";
import type { RuntimeDeps } from "../ports";
import type { SendTurnInput } from "../runtime/thread";
import { AgentThread } from "../runtime/thread";
import type { InMemorySeed, InMemoryStores } from "../testing/fixtures";
import { createInMemoryDeps } from "../testing/fixtures";
import type { ThreadScope } from "../thread-scope";
import { evaluateAgentTrace, type AgentTraceExpectation } from "./assertions";
import { toJsonValue } from "./json";
import { buildAgentObservation, captureModelRequest } from "./trace";
import type {
  AgentEvalObservation,
  EvalAssessment,
  EvalScenario,
  EvalVariant,
  JsonValue,
} from "./types";
import { EvalStageError } from "./types";

export type AgentEvalTurn = Omit<SendTurnInput, "signal">;

export interface AgentEvalSetupContext {
  deps: RuntimeDeps;
  stores: InMemoryStores;
}

export interface AgentEvalScenario extends EvalScenario<AgentEvalObservation> {
  scope: ThreadScope;
  seed: InMemorySeed;
  turns: AgentEvalTurn[];
  /** quality 维度的语义评分标准；仅在 --judge 运行时由 LLM judge 打分。 */
  rubric?: string[];
  setup?: (context: AgentEvalSetupContext) => void | Promise<void>;
  observeState?: (context: AgentEvalSetupContext) => unknown | Promise<unknown>;
}

export interface DefineAgentEvalScenarioOptions {
  id: string;
  description: string;
  tags?: string[];
  scope: ThreadScope;
  seed?: InMemorySeed;
  /** 真书等大 fixture 的工件替身：写进 run 记录的是它，而不是整个 seed。 */
  seedSummary?: JsonValue;
  turns: AgentEvalTurn[];
  expectation?: AgentTraceExpectation;
  /** quality 评分标准（每条一句可判定的陈述）；写进 run 工件，--judge 时生效。 */
  rubric?: string[];
  /** Serializable description of custom state or semantic checks. */
  criteria?: JsonValue;
  evaluate?: (observation: AgentEvalObservation) => EvalAssessment | Promise<EvalAssessment>;
  setup?: AgentEvalScenario["setup"];
  observeState?: AgentEvalScenario["observeState"];
}

export interface AgentEvalVariantOptions {
  id: string;
  description?: string;
  account?: LlmAccount;
  modelId: string;
  registry?: ProviderRegistry;
  /** Deterministic/provider-test seam; normal evals resolve from account + registry. */
  resolveModel?: ResolveModel;
  getApiKey?: (provider: string) => string | undefined;
  thinkingLevel?: ThinkingLevel;
  maxWindowTurns?: number;
  completeFn?: CompleteFn;
  streamFn?: StreamFn;
  transformSystemPrompt?: (prompt: string, scope: ThreadScope) => string;
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function noMemoryComplete(model: Model<Api>, _context: Context): Promise<AssistantMessage> {
  return Promise.resolve({
    role: "assistant",
    content: [{ type: "text", text: '{"new": [], "reinforced": []}' }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  });
}

function scenarioInput(options: DefineAgentEvalScenarioOptions): JsonValue {
  return toJsonValue({
    scope: options.scope,
    seed: options.seedSummary ?? options.seed ?? {},
    turns: options.turns,
    expectation: options.expectation ?? {},
    ...(options.rubric === undefined ? {} : { rubric: options.rubric }),
    ...(options.criteria === undefined ? {} : { criteria: options.criteria }),
  });
}

export function defineAgentEvalScenario(
  options: DefineAgentEvalScenarioOptions,
): AgentEvalScenario {
  const expectation = options.expectation ?? {};
  return {
    id: options.id,
    description: options.description,
    tags: options.tags,
    scope: options.scope,
    seed: options.seed ?? {},
    turns: options.turns,
    rubric: options.rubric,
    input: scenarioInput(options),
    evaluate: options.evaluate ?? ((observation) => evaluateAgentTrace(observation, expectation)),
    setup: options.setup,
    observeState: options.observeState,
  };
}

export function createAgentEvalVariant(
  options: AgentEvalVariantOptions,
): EvalVariant<AgentEvalScenario, AgentEvalObservation> {
  const thinkingLevel = options.thinkingLevel ?? "medium";
  if (!options.resolveModel && (!options.account || !options.registry)) {
    throw new Error("agent eval variant requires resolveModel or account + registry");
  }
  if (!options.streamFn && (!options.account || !options.registry)) {
    throw new Error("agent eval variant requires streamFn or account + registry");
  }
  const baseStreamFn =
    options.streamFn ?? createStreamFn(options.registry!, options.account!, thinkingLevel);
  const completeFn = options.completeFn ?? noMemoryComplete;
  const baseResolve =
    options.resolveModel ??
    createModelResolver(
      options.account!,
      { smart: options.modelId, fast: options.modelId },
      options.registry,
    );
  // OpenRouter 变体统一带上 eval 的上游路由偏好（CoreWeave 优先）。
  const resolveModel: ResolveModel = (role) => applyEvalRouting(baseResolve(role));
  const selectedModel = resolveModel("smart");

  return {
    id: options.id,
    description: options.description,
    metadata: {
      provider: options.account ? accountProviderId(options.account) : selectedModel.provider,
      model: options.modelId,
      thinkingLevel,
      ...(options.maxWindowTurns === undefined
        ? {}
        : { maxWindowTurns: options.maxWindowTurns }),
      promptTransform: options.transformSystemPrompt ? "custom" : "default",
    },
    run: async (scenario, context) => {
      const startedAt = performance.now();
      let setupContext: AgentEvalSetupContext;
      try {
        setupContext = createInMemoryDeps(scenario.seed);
        await scenario.setup?.(setupContext);
      } catch (error) {
        throw new EvalStageError("setup", `scenario setup failed: ${scenario.id}`, error);
      }

      const modelRequests: AgentEvalObservation["modelRequests"] = [];
      let activeTurn = 0;
      let activeRound = 0;
      const tracedStreamFn: StreamFn = (
        model: Model<Api>,
        modelContext: Context,
        streamOptions?: SimpleStreamOptions,
      ) => {
        activeRound += 1;
        modelRequests.push(
          captureModelRequest(activeTurn, activeRound, model, modelContext, streamOptions),
        );
        return baseStreamFn(model, modelContext, streamOptions);
      };

      const thread = new AgentThread({
        scope: scenario.scope,
        deps: setupContext.deps,
        resolveModel,
        getApiKey:
          options.getApiKey ??
          (() => (options.account ? accountCredential(options.account) : undefined)),
        completeFn,
        streamFn: tracedStreamFn,
        thinkingLevel,
        maxWindowTurns: options.maxWindowTurns,
        transformSystemPrompt: options.transformSystemPrompt,
      });
      const rawTurns: Array<{ input: AgentEvalTurn; chunks: AgentEvalObservation["turns"][number]["chunks"] }> = [];

      try {
        for (const [index, turn] of scenario.turns.entries()) {
          context.signal.throwIfAborted();
          activeTurn = index + 1;
          activeRound = 0;
          const chunks: AgentEvalObservation["turns"][number]["chunks"] = [];
          for await (const chunk of thread.sendTurn({ ...turn, signal: context.signal })) {
            chunks.push(chunk);
          }
          rawTurns.push({ input: turn, chunks });
        }
        await thread.flushBackgroundWork();
        const state = await scenario.observeState?.(setupContext);
        const observation = buildAgentObservation({
          turns: rawTurns,
          modelRequests,
          wallTimeMs: performance.now() - startedAt,
          state,
        });
        return { observation, telemetry: observation.telemetry };
      } catch (error) {
        throw new EvalStageError("execution", `agent execution failed: ${scenario.id}`, error);
      } finally {
        thread.dispose();
      }
    },
  };
}
