import { captureReviewEvidence } from "./review-evidence";
import { toJsonValue } from "./json";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions, Usage } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { accountCredential, accountProviderId, createModelResolver } from "../models/accounts";
import { createStreamFn, type StreamFn } from "../models/complete";
import type { ResolveModel } from "../models/roles";
import { AgentThread } from "../runtime/thread";
import { createInMemoryEnvironment } from "./host";
import { hostTurn } from "../testing/transcript-host";
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
export async function createManualEvalSession(options: ManualEvalSessionOptions): Promise<ManualEvalSession> {
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
  // The viewer has no app host: a free session reads the book's snapshot through the in-memory port.
  const setupContext = createInMemoryEnvironment(options.scenario);
  await options.scenario.setup?.(setupContext);

  let activeRound = 0;
  let modelRequests: AgentEvalObservation["modelRequests"] = [];
  const tracedStreamFn: StreamFn = (model: Model<Api>, modelContext: Context, streamOptions?: SimpleStreamOptions) => {
    activeRound += 1;
    modelRequests.push(captureModelRequest(1, activeRound, model, modelContext, streamOptions));
    return baseStreamFn(model, modelContext, streamOptions);
  };
  const thread = new AgentThread({
    scope: options.scenario.scope,
    deps: setupContext.deps,
    resolveModel,
    getApiKey: () => accountCredential(resolved.account),
    completeFn: noMemoryComplete,
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
        ...(options.inheritSelection && anchorTurn?.attachments?.length ? { attachments: anchorTurn.attachments } : {}),
      };
      const chunks: AgentEvalObservation["turns"][number]["chunks"] = [];
      const initialState = options.scenario.observeState
        ? toJsonValue(await options.scenario.observeState(setupContext))
        : undefined;
      const originalSources = structuredClone({
        books: setupContext.stores.books,
        chapters: setupContext.stores.chapters,
      });
      const startedAt = performance.now();
      // A manual session is a continuing chat: the session plays the host that
      // owns the transcript (ConversationPort), so follow-ups see prior turns.
      for await (const chunk of hostTurn(setupContext.stores.turns, thread, { ...turn, signal: askOptions?.signal })) {
        chunks.push(chunk);
      }
      await thread.flushBackgroundWork();
      const state = await options.scenario.observeState?.(setupContext);
      const observation = buildAgentObservation({
        turns: [
          {
            input: turn,
            chunks,
            stateBefore: initialState,
            stateAfter: state === undefined ? undefined : toJsonValue(state),
          },
        ],
        modelRequests,
        wallTimeMs: performance.now() - startedAt,
        state,
      });
      observation.reviewEvidence = captureReviewEvidence(
        { ...options.scenario, turns: [turn] },
        originalSources,
        observation,
        initialState,
      );
      return observation;
    },
    dispose: () => {
      disposed = true;
      thread.dispose();
    },
  };
}
