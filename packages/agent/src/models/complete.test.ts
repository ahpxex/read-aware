import { describe, expect, test } from "bun:test";
import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
} from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import type { LlmAccount } from "./accounts";
import { createCompleteFn, createStreamFn } from "./complete";
import { CUSTOM_OPENAI_PROVIDER_ID } from "./custom-openai";
import type { ProviderRegistry } from "./registry";
import type { ThinkingLevel } from "./roles";

const ACCOUNT: LlmAccount = { kind: "api-key", provider: "openai", apiKey: "k" };
const MODEL = { id: "m" } as Model<Api>;
const CONTEXT: Context = { messages: [] };

function stubRegistry(onOptions: (options: unknown) => void): ProviderRegistry {
  return {
    completeSimple: (_model: unknown, _context: unknown, options: unknown) => {
      onOptions(options);
      return Promise.resolve(fauxAssistantMessage("ok"));
    },
  } as unknown as ProviderRegistry;
}

function stubStreamRegistry(
  onOptions: (options: unknown) => void,
): ProviderRegistry {
  return {
    streamSimple: (_model: unknown, _context: unknown, options: unknown) => {
      onOptions(options);
      return {} as AssistantMessageEventStream;
    },
  } as unknown as ProviderRegistry;
}

async function reasoningSentFor(thinking: ThinkingLevel | undefined): Promise<string | undefined> {
  let captured: { reasoning?: string } | undefined;
  const fn = createCompleteFn(
    stubRegistry((options) => {
      captured = options as typeof captured;
    }),
    ACCOUNT,
    thinking,
  );
  await fn(MODEL, CONTEXT);
  return captured?.reasoning;
}

describe("createCompleteFn", () => {
  test("passes the thinking effort through as reasoning", async () => {
    expect(await reasoningSentFor("medium")).toBe("medium");
  });

  test('"off" and unset send no reasoning', async () => {
    expect(await reasoningSentFor("off")).toBeUndefined();
    expect(await reasoningSentFor(undefined)).toBeUndefined();
  });

  test("sanitizes compatibility fields only for Custom accounts", async () => {
    let captured:
      | {
          onPayload?: (
            payload: unknown,
            model: Model<Api>,
          ) => unknown | Promise<unknown>;
        }
      | undefined;
    const custom: LlmAccount = {
      kind: "api-key",
      provider: CUSTOM_OPENAI_PROVIDER_ID,
      apiKey: "k",
      baseUrl: "https://gateway.example/v1",
      api: "openai-responses",
    };
    const fn = createCompleteFn(
      stubRegistry((options) => {
        captured = options as typeof captured;
      }),
      custom,
    );

    await fn(MODEL, CONTEXT);
    expect(
      await captured?.onPayload?.(
        {
          model: "custom-model",
          store: false,
          max_output_tokens: 8_192,
          prompt_cache_key: "session",
        },
        MODEL,
      ),
    ).toEqual({ model: "custom-model" });
  });

  test("routes provider requests through the host transport", async () => {
    let captured: { fetch?: typeof globalThis.fetch } | undefined;
    let request:
      | { input: RequestInfo | URL; init?: RequestInit }
      | undefined;
    const hostFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      request = { input, init };
      return new Response("native response");
    };
    const fn = createCompleteFn(
      stubRegistry((options) => {
        captured = options as typeof captured;
      }),
      ACCOUNT,
      undefined,
      hostFetch,
    );

    await fn(MODEL, CONTEXT);
    const response = await captured?.fetch?.("https://gateway.example/v1", {
      method: "POST",
    });

    expect(await response?.text()).toBe("native response");
    expect(request).toEqual({
      input: "https://gateway.example/v1",
      init: { method: "POST" },
    });
    expect(captured?.fetch?.preconnect).toBeFunction();
  });

  test("preserves agent-loop options in the configured stream", () => {
    let captured:
      | { cacheRetention?: string; reasoning?: string; signal?: AbortSignal }
      | undefined;
    const signal = new AbortController().signal;
    const stream = createStreamFn(
      stubStreamRegistry((options) => {
        captured = options as typeof captured;
      }),
      ACCOUNT,
      "high",
    );

    stream(MODEL, CONTEXT, {
      cacheRetention: "short",
      reasoning: "low",
      signal,
    });

    expect(captured).toMatchObject({
      cacheRetention: "short",
      reasoning: "high",
      signal,
    });
  });
});
