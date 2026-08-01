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

function inspectCompletionChunk(data: string, state: CompletionStreamState): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return;
  }

  const chunk = asRecord(parsed);
  const choice = asRecord(Array.isArray(chunk?.choices) ? chunk.choices[0] : undefined);
  if (!chunk || !choice) return;

  state.sawChoice = true;
  state.envelope = {
    id: chunk.id,
    object: chunk.object,
    created: chunk.created,
    model: chunk.model,
  };
  if (typeof choice.index === "number") state.choiceIndex = choice.index;

  if (
    choice.finish_reason !== null &&
    choice.finish_reason !== undefined &&
    choice.finish_reason !== ""
  ) {
    state.sawFinishReason = true;
  }

  const delta = asRecord(choice.delta);
  if (!delta) return;

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
  }
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
  const match = /^data:\s?(.*)$/.exec(normalized);
  if (!match) return line;

  const data = match[1]?.trim() ?? "";
  if (data !== DONE_SENTINEL) {
    inspectCompletionChunk(data, state);
    return line;
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
  const state: CompletionStreamState = {
    envelope: {},
    choiceIndex: 0,
    sawChoice: false,
    sawFinishReason: false,
    sawOutput: false,
    sawToolCall: false,
  };
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

function withCompletionCompatibility(fetch: FetchFunction): FetchFunction {
  const compatibleFetch = async (
    input: Parameters<FetchFunction>[0],
    init?: Parameters<FetchFunction>[1],
  ) => {
    const response = await fetch(input, init);
    if (
      !response.ok ||
      !response.body ||
      !response.headers.get("content-type")?.includes("text/event-stream")
    ) {
      return response;
    }

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(patchCompletionSse(response.body), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
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
 * Chat Completions adapter for third-party gateways. It keeps pi's normal
 * parser and only repairs the common clean-[DONE]/missing-finish-reason case.
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
