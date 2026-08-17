import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ThreadChunk } from "../chunks";
import { toJsonObject, toJsonValue } from "./json";
import type {
  AgentEvalObservation,
  AgentEvalTurnObservation,
  CapturedModelRequest,
  EvalInteraction,
  EvalTelemetry,
  EvalTokenUsage,
  EvalToolCall,
  JsonObject,
  JsonValue,
} from "./types";

export interface RawEvalTurn {
  input: unknown;
  chunks: ThreadChunk[];
}

function snapshotContent(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map(snapshotContent);
  if (!value || typeof value !== "object") return toJsonValue(value);

  const record = value as Record<string, unknown>;
  if (record.type === "image" && typeof record.data === "string") {
    return {
      ...toJsonObject(record),
      data: `[omitted image data: ${record.data.length} chars]`,
    };
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, snapshotContent(entry)]),
  );
}

export function snapshotModelContext(context: Context): JsonObject {
  return {
    ...(context.systemPrompt ? { systemPrompt: context.systemPrompt } : {}),
    messages: context.messages.map((message) => snapshotContent(message)),
    tools: (context.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: snapshotContent(tool.parameters),
      ...(tool.constrainedSampling
        ? { constrainedSampling: snapshotContent(tool.constrainedSampling) }
        : {}),
    })),
  };
}

export function snapshotStreamOptions(options: SimpleStreamOptions | undefined): JsonObject {
  if (!options) return {};
  const safeKeys: Array<keyof SimpleStreamOptions> = [
    "reasoning",
    "maxTokens",
    "temperature",
    "cacheRetention",
    "timeoutMs",
    "maxRetries",
    "maxRetryDelayMs",
    "metadata",
    "thinkingBudgets",
  ];
  const output: JsonObject = {};
  for (const key of safeKeys) {
    const value = options[key];
    if (value !== undefined) output[key] = toJsonValue(value);
  }
  return output;
}

export function captureModelRequest(
  turn: number,
  round: number,
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): CapturedModelRequest {
  return {
    turn,
    round,
    model: { provider: model.provider, id: model.id, api: model.api },
    context: snapshotModelContext(context),
    options: snapshotStreamOptions(options),
  };
}

function collectTools(turns: AgentEvalTurnObservation[]): EvalToolCall[] {
  const tools: EvalToolCall[] = [];
  for (const turn of turns) {
    for (const chunk of turn.chunks) {
      if (chunk.type !== "tool-step") continue;
      if (chunk.phase === "start") {
        tools.push({
          turn: turn.turn,
          id: chunk.id,
          name: chunk.tool,
          ...(chunk.args === undefined ? {} : { args: toJsonValue(chunk.args) }),
        });
        continue;
      }
      const call = [...tools]
        .reverse()
        .find((entry) => entry.turn === turn.turn && entry.id === chunk.id);
      if (!call) continue;
      if (chunk.output !== undefined) call.output = chunk.output;
      if (chunk.phase === "end") call.isError = chunk.isError ?? false;
    }
  }
  return tools;
}

function collectInteractions(turns: AgentEvalTurnObservation[]): EvalInteraction[] {
  const interactions: EvalInteraction[] = [];
  for (const turn of turns) {
    for (const chunk of turn.chunks) {
      if (chunk.type !== "interaction") continue;
      if (chunk.phase === "request") {
        interactions.push({
          turn: turn.turn,
          phase: "request",
          kind: chunk.request.kind,
          id: chunk.request.id,
          value: toJsonValue(chunk.request),
        });
      } else {
        const interaction: EvalInteraction = {
          turn: turn.turn,
          phase: "response",
          id: chunk.id,
          value: toJsonValue(chunk.answer),
        };
        const duplicate = interactions.some(
          (entry) =>
            entry.turn === interaction.turn &&
            entry.phase === interaction.phase &&
            entry.id === interaction.id &&
            JSON.stringify(entry.value) === JSON.stringify(interaction.value),
        );
        if (!duplicate) interactions.push(interaction);
      }
    }
  }
  return interactions;
}

function addTokens(target: EvalTokenUsage, chunk: Extract<ThreadChunk, { type: "metric" }>): void {
  if (!chunk.tokens) return;
  target.input += chunk.tokens.input;
  target.output += chunk.tokens.output;
  target.cacheRead += chunk.tokens.cacheRead;
  target.cacheWrite += chunk.tokens.cacheWrite;
  target.total +=
    chunk.tokens.input +
    chunk.tokens.output +
    chunk.tokens.cacheRead +
    chunk.tokens.cacheWrite;
}

function collectTelemetry(turns: AgentEvalTurnObservation[], wallTimeMs: number): EvalTelemetry {
  const metrics = turns.flatMap((turn) =>
    turn.chunks.filter(
      (chunk): chunk is Extract<ThreadChunk, { type: "metric" }> => chunk.type === "metric",
    ),
  );
  const tokens: EvalTokenUsage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  };
  for (const metric of metrics) addTokens(tokens, metric);
  const costs = metrics.flatMap((metric) =>
    metric.costUsd === undefined ? [] : [metric.costUsd],
  );
  return {
    wallTimeMs,
    modelTimeMs: metrics.reduce((total, metric) => total + metric.totalMs, 0),
    meanTtfbMs:
      metrics.length === 0
        ? undefined
        : metrics.reduce((total, metric) => total + metric.ttfbMs, 0) / metrics.length,
    rounds: metrics.length,
    tokens: metrics.some((metric) => metric.tokens) ? tokens : undefined,
    costUsd: costs.length === 0 ? undefined : costs.reduce((total, cost) => total + cost, 0),
  };
}

export function buildAgentObservation(input: {
  turns: RawEvalTurn[];
  modelRequests: CapturedModelRequest[];
  wallTimeMs: number;
  state?: unknown;
}): AgentEvalObservation {
  const turns = input.turns.map<AgentEvalTurnObservation>((turn, index) => ({
    turn: index + 1,
    input: toJsonObject(turn.input),
    // 轮感知拼接：流式增量轮内无缝连接，但跨模型轮（中间隔着 tool/metric
    // 块）的文本之间补空行——否则前一轮的过程叙述和最终回答粘成一句
    // （"...for you.Done."），污染被评分的答案串。
    answer: turn.chunks.reduce<{ text: string; boundary: boolean }>(
      (state, chunk) => {
        if (chunk.type === "text") {
          return {
            text:
              state.boundary && state.text ? `${state.text}\n\n${chunk.text}` : state.text + chunk.text,
            boundary: false,
          };
        }
        if (chunk.type === "tool-step" || chunk.type === "metric") {
          return { ...state, boundary: true };
        }
        return state;
      },
      { text: "", boundary: false },
    ).text,
    thinking: turn.chunks
      .filter(
        (chunk): chunk is Extract<ThreadChunk, { type: "thinking" }> => chunk.type === "thinking",
      )
      .map((chunk) => chunk.text)
      .join(""),
    chunks: turn.chunks,
  }));
  const finalTurn = turns[turns.length - 1];
  return {
    turns,
    answer: finalTurn?.answer ?? "",
    thinking: turns.map((turn) => turn.thinking).filter(Boolean).join("\n"),
    tools: collectTools(turns),
    interactions: collectInteractions(turns),
    modelRequests: input.modelRequests,
    telemetry: collectTelemetry(turns, input.wallTimeMs),
    ...(input.state === undefined ? {} : { state: toJsonValue(input.state) }),
  };
}
