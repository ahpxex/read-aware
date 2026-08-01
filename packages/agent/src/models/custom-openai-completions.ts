import type {
  FetchFunction,
  ProviderStreams,
  StreamOptions,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

type CompletionEnvelope = {
  id?: unknown;
  object?: unknown;
  created?: unknown;
  model?: unknown;
};

type CompletionStreamState = {
  envelope: CompletionEnvelope;
  choiceIndex: number;
  sawChoice: boolean;
  sawFinishReason: boolean;
  sawOutput: boolean;
  sawToolCall: boolean;
  toolCallIds: Map<number, string>;
};

const DONE_SENTINEL = "[DONE]";
const REASONING_FIELDS = [
  "reasoning_content",
  "reasoning",
  "reasoning_text",
] as const;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeFinishReason(reason: string): string | undefined {
  const normalized = reason.trim().toLowerCase().replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "":
    case "null":
    case "none":
    case "pending":
      return undefined;
    case "stop":
    case "end":
      return "stop";
    case "eos":
    case "eos_token":
    case "end_turn":
    case "complete":
    case "completed":
      return "stop";
    case "length":
      return "length";
    case "max_token":
    case "max_tokens":
    case "token_limit":
      return "length";
    case "function_call":
    case "tool_calls":
      return normalized;
    case "tool_call":
    case "tool_use":
      return "tool_calls";
    default:
      return normalized;
  }
}

function generatedToolCallId(): string {
  return `call_${crypto.randomUUID().replace(/-/g, "")}`;
}

function normalizeToolCall(
  value: unknown,
  position: number,
  state: CompletionStreamState,
): unknown {
  const source = asRecord(value);
  if (!source) return value;

  const numericIndex =
    typeof source.index === "number"
      ? source.index
      : typeof source.index === "string" && /^\d+$/.test(source.index)
        ? Number(source.index)
        : undefined;
  const knownIndex =
    typeof source.id === "string"
      ? [...state.toolCallIds].find(([, id]) => id === source.id)?.[0]
      : undefined;
  const index = numericIndex ?? knownIndex ?? position;
  let id = state.toolCallIds.get(index);
  if (!id) {
    id =
      typeof source.id === "string" && source.id.length > 0
        ? source.id
        : generatedToolCallId();
    state.toolCallIds.set(index, id);
  }

  const next: Record<string, unknown> = { ...source, index, id };
  const fn = asRecord(source.function);
  if (fn) {
    const args = fn.arguments;
    next.type ??= "function";
    next.function = {
      ...fn,
      ...(args !== undefined && typeof args !== "string"
        ? { arguments: JSON.stringify(args) }
        : {}),
    };
  }
  return next;
}

function normalizeContent(value: unknown): unknown {
  if (!Array.isArray(value)) return value;

  const parts = value.flatMap((part) => {
    if (typeof part === "string") return [part];
    const record = asRecord(part);
    if (!record) return [];
    if (typeof record.text === "string") return [record.text];
    if (typeof record.content === "string") return [record.content];
    return [];
  });
  return parts.length > 0 ? parts.join("") : value;
}

function completionDelta(choice: Record<string, unknown>): Record<string, unknown> | undefined {
  const existing = asRecord(choice.delta);
  if (existing) return existing;

  const message = asRecord(choice.message);
  if (message) {
    const delta = { ...message };
    choice.delta = delta;
    delete choice.message;
    return delta;
  }

  if (typeof choice.text === "string") {
    const delta = { content: choice.text };
    choice.delta = delta;
    delete choice.text;
    return delta;
  }
  return undefined;
}

function candidateFinishReason(
  chunk: Record<string, unknown>,
  choice: Record<string, unknown>,
): string | undefined {
  const candidates = [
    choice.finish_reason,
    choice.native_finish_reason,
    choice.stop_reason,
    choice.finishReason,
    chunk.finish_reason,
    chunk.stop_reason,
  ];
  return candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
}

function normalizeCompletionChunk(
  data: string,
  state: CompletionStreamState,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return data;
  }

  const chunk = asRecord(parsed);
  const choice = asRecord(
    Array.isArray(chunk?.choices) ? chunk.choices[0] : undefined,
  );
  if (!chunk || !choice) return data;

  state.sawChoice = true;
  state.envelope = {
    id: chunk.id,
    object: chunk.object,
    created: chunk.created,
    model: chunk.model,
  };
  if (typeof choice.index === "number") state.choiceIndex = choice.index;

  const delta = completionDelta(choice);
  if (delta) {
    if (delta.content !== undefined) {
      delta.content = normalizeContent(delta.content);
    }

    const legacyFunctionCall = asRecord(delta.function_call);
    if (!Array.isArray(delta.tool_calls) && legacyFunctionCall) {
      delta.tool_calls = [
        {
          index: 0,
          type: "function",
          function: legacyFunctionCall,
        },
      ];
      delete delta.function_call;
    } else if (
      delta.tool_calls !== undefined &&
      !Array.isArray(delta.tool_calls)
    ) {
      delta.tool_calls = [delta.tool_calls];
    }

    if (typeof delta.content === "string" && delta.content.length > 0) {
      state.sawOutput = true;
    }
    for (const field of REASONING_FIELDS) {
      if (typeof delta[field] === "string" && delta[field].length > 0) {
        state.sawOutput = true;
      }
    }
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
      state.sawOutput = true;
      state.sawToolCall = true;
      delta.tool_calls = delta.tool_calls.map((toolCall, index) =>
        normalizeToolCall(toolCall, index, state),
      );
    }
  }

  const rawFinishReason = candidateFinishReason(chunk, choice);
  const finishReason = rawFinishReason
    ? normalizeFinishReason(rawFinishReason)
    : undefined;
  if (finishReason) {
    choice.finish_reason = finishReason;
    state.sawFinishReason = true;
  } else if (chunk.done === true || choice.done === true) {
    choice.finish_reason = state.sawToolCall ? "tool_calls" : "stop";
    state.sawFinishReason = true;
  } else if (rawFinishReason || choice.finish_reason !== undefined) {
    choice.finish_reason = null;
  }

  return JSON.stringify(chunk);
}

function syntheticFinishChunk(state: CompletionStreamState): string {
  const chunk = {
    ...state.envelope,
    choices: [
      {
        index: state.choiceIndex,
        delta: {},
        finish_reason: state.sawToolCall ? "tool_calls" : "stop",
      },
    ],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function patchSseLine(line: string, state: CompletionStreamState): string {
  const withoutNewline = line.endsWith("\n") ? line.slice(0, -1) : line;
  const normalized = withoutNewline.endsWith("\r")
    ? withoutNewline.slice(0, -1)
    : withoutNewline;
  const match = /^\uFEFF?data:\s?(.*)$/.exec(normalized);
  if (!match) return line;

  const data = match[1]?.trim() ?? "";
  if (data !== DONE_SENTINEL) {
    const normalizedData = normalizeCompletionChunk(data, state);
    const ending = line.endsWith("\r\n")
      ? "\r\n"
      : line.endsWith("\n")
        ? "\n"
        : "";
    return `data: ${normalizedData}${ending}`;
  }

  // A number of otherwise compatible gateways send an explicit [DONE] but
  // omit the terminal finish_reason chunk. Infer only at that clean sentinel;
  // an interrupted/empty stream must remain an error.
  if (state.sawChoice && state.sawOutput && !state.sawFinishReason) {
    return syntheticFinishChunk(state) + line;
  }
  return line;
}

function patchCompletionSse(
  source: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state = newCompletionState();
  let buffer = "";

  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline + 1);
          buffer = buffer.slice(newline + 1);
          controller.enqueue(encoder.encode(patchSseLine(line, state)));
          newline = buffer.indexOf("\n");
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer.length > 0) {
          controller.enqueue(encoder.encode(patchSseLine(buffer, state)));
        }
      },
    }),
  );
}

function textStream(value: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function asCompletionSseResponse(
  response: Response,
  body: ReadableStream<Uint8Array>,
): Response {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/event-stream; charset=utf-8");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function newCompletionState(): CompletionStreamState {
  return {
    envelope: {},
    choiceIndex: 0,
    sawChoice: false,
    sawFinishReason: false,
    sawOutput: false,
    sawToolCall: false,
    toolCallIds: new Map(),
  };
}

function jsonValuesToSse(values: unknown[], cleanBody: boolean): string {
  const state = newCompletionState();
  let output = "";
  let hasDoneMarker = false;

  for (const value of values) {
    const record = asRecord(value);
    hasDoneMarker ||=
      record?.done === true ||
      record?.event === "done" ||
      record?.event === "completed";
    const normalized = normalizeCompletionChunk(JSON.stringify(value), state);
    output += `data: ${normalized}\n\n`;
  }

  if (
    state.sawChoice &&
    !state.sawFinishReason &&
    (cleanBody || hasDoneMarker)
  ) {
    output += syntheticFinishChunk(state);
  }
  if (cleanBody || hasDoneMarker || state.sawFinishReason) {
    output += `data: ${DONE_SENTINEL}\n\n`;
  }
  return output;
}

function jsonCompletionBodyToSse(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as unknown;
    return jsonValuesToSse(Array.isArray(parsed) ? parsed : [parsed], true);
  } catch {
    const lines = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return undefined;

    try {
      return jsonValuesToSse(
        lines.map((line) => JSON.parse(line) as unknown),
        false,
      );
    } catch {
      return undefined;
    }
  }
}

async function sniffJsonBody(
  body: ReadableStream<Uint8Array>,
): Promise<{ body: ReadableStream<Uint8Array>; isJson: boolean }> {
  const [probe, replay] = body.tee();
  const reader = probe.getReader();
  const decoder = new TextDecoder();
  let prefix = "";

  try {
    while (prefix.length < 1_024) {
      const { done, value } = await reader.read();
      if (done) break;
      prefix += decoder.decode(value, { stream: true });
      const meaningful = prefix.replace(/^\uFEFF?\s*/, "");
      if (meaningful.length > 0) {
        return {
          body: replay,
          isJson: meaningful.startsWith("{") || meaningful.startsWith("["),
        };
      }
    }
    return { body: replay, isJson: false };
  } finally {
    // Do not await this: one tee branch only finishes cancellation after the
    // replay branch has been consumed.
    void reader.cancel().catch(() => undefined);
  }
}

function withCompletionCompatibility(fetch: FetchFunction): FetchFunction {
  const compatibleFetch = async (
    input: Parameters<FetchFunction>[0],
    init?: Parameters<FetchFunction>[1],
  ) => {
    const response = await fetch(input, init);
    if (!response.ok || !response.body) {
      return response;
    }

    const sniffed = await sniffJsonBody(response.body);
    if (sniffed.isJson) {
      const body = await new Response(sniffed.body).text();
      const sse = jsonCompletionBodyToSse(body);
      if (sse !== undefined) {
        return asCompletionSseResponse(response, textStream(sse));
      }
      return asCompletionSseResponse(
        response,
        patchCompletionSse(textStream(body)),
      );
    }

    return asCompletionSseResponse(
      response,
      patchCompletionSse(sniffed.body),
    );
  };

  return Object.assign(compatibleFetch, {
    // Bun augments fetch with this optional optimization; browsers do not.
    preconnect:
      typeof fetch.preconnect === "function"
        ? fetch.preconnect.bind(fetch)
        : () => undefined,
  });
}

function compatibleOptions(options?: StreamOptions): StreamOptions {
  return {
    ...options,
    fetch: withCompletionCompatibility(options?.fetch ?? globalThis.fetch),
  };
}

/**
 * Chat Completions adapter for third-party gateways. It normalizes common
 * wire-format deviations, then delegates semantic parsing to pi.
 */
export function customOpenAICompletionsApi(): ProviderStreams {
  const upstream = openAICompletionsApi();
  return {
    stream(model, context, options) {
      return upstream.stream(model, context, compatibleOptions(options));
    },
    streamSimple(model, context, options) {
      return upstream.streamSimple(model, context, compatibleOptions(options));
    },
  };
}
