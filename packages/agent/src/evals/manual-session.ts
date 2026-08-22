import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions, Usage } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { accountCredential, accountProviderId, createModelResolver } from "../models/accounts";
import { createCompleteFn, createStreamFn, type CompleteFn, type StreamFn } from "../models/complete";
import type { ResolveModel } from "../models/roles";
import { AgentThread } from "../runtime/thread";
import { createInMemoryDeps } from "../testing/fixtures";
import { applyEvalRouting, evalProviderRegistry, resolveEvalModel } from "./model-config";
import type { AgentEvalScenario, AgentEvalTurn } from "./agent-harness";
import { buildAgentObservation, captureModelRequest } from "./trace";
import type { AgentEvalObservation } from "./types";

export interface ManualEvalSessionOptions {
  scenario: AgentEvalScenario;
  provider: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  inheritSelection?: boolean;
}

export interface ManualEvalSession {
  metadata: { provider: string; model: string; thinkingLevel: ThinkingLevel };
  ask(question: string, options?: { signal?: AbortSignal }): Promise<AgentEvalObservation>;
  dispose(): void;
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

/**
 * Interactive qualitative-eval session. It reuses a registered scenario's
 * world state and reading position, but the reviewer supplies every user turn.
 */
export async function createManualEvalSession(
  options: ManualEvalSessionOptions,
): Promise<ManualEvalSession> {
  const thinkingLevel = options.thinkingLevel ?? "medium";
  const registry = evalProviderRegistry();
  const resolved = resolveEvalModel(registry, options.provider, options.modelId);
  const baseResolve = createModelResolver(
    resolved.account,
    { smart: resolved.modelId, fast: resolved.modelId },
    registry,
  );
  const resolveModel: ResolveModel = (role) => applyEvalRouting(baseResolve(role));
  const baseStreamFn = createStreamFn(registry, resolved.account, thinkingLevel);
  const repairCompleteFn = createCompleteFn(registry, resolved.account, thinkingLevel);
  const setupContext = createInMemoryDeps(options.scenario.seed);
  await options.scenario.setup?.(setupContext);

  let activeRound = 0;
  let modelRequests: AgentEvalObservation["modelRequests"] = [];
  const tracedStreamFn: StreamFn = (
    model: Model<Api>,
    modelContext: Context,
    streamOptions?: SimpleStreamOptions,
  ) => {
    activeRound += 1;
    modelRequests.push(captureModelRequest(1, activeRound, model, modelContext, streamOptions));
    return baseStreamFn(model, modelContext, streamOptions);
  };
  const tracedRepairCompleteFn: CompleteFn = (model, modelContext, completeOptions) => {
    activeRound += 1;
    modelRequests.push(captureModelRequest(1, activeRound, model, modelContext, completeOptions));
    return repairCompleteFn(model, modelContext, completeOptions);
  };
  const thread = new AgentThread({
    scope: options.scenario.scope,
    deps: setupContext.deps,
    resolveModel,
    getApiKey: () => accountCredential(resolved.account),
    completeFn: noMemoryComplete,
    repairCompleteFn: tracedRepairCompleteFn,
    streamFn: tracedStreamFn,
    thinkingLevel,
  });
  const anchorTurn = options.scenario.turns[options.scenario.turns.length - 1];
  let disposed = false;

  return {
    metadata: {
      provider: accountProviderId(resolved.account),
      model: resolved.modelId,
      thinkingLevel,
    },
    ask: async (question, askOptions) => {
      if (disposed) throw new Error("manual eval session is closed");
      const text = question.trim();
      if (!text) throw new Error("manual eval question is required");
      activeRound = 0;
      modelRequests = [];
      const turn: AgentEvalTurn = {
        text,
        ...(anchorTurn?.readingCursor ? { readingCursor: anchorTurn.readingCursor } : {}),
        ...(options.inheritSelection && anchorTurn?.attachments?.length
          ? { attachments: anchorTurn.attachments }
          : {}),
      };
      const chunks: AgentEvalObservation["turns"][number]["chunks"] = [];
      const startedAt = performance.now();
      for await (const chunk of thread.sendTurn({ ...turn, signal: askOptions?.signal })) {
        chunks.push(chunk);
      }
      await thread.flushBackgroundWork();
      const state = await options.scenario.observeState?.(setupContext);
      return buildAgentObservation({
        turns: [{ input: turn, chunks }],
        modelRequests,
        wallTimeMs: performance.now() - startedAt,
        state,
      });
    },
    dispose: () => {
      disposed = true;
      thread.dispose();
    },
  };
}
