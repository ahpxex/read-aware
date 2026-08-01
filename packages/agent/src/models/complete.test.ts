import { describe, expect, test } from "bun:test";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import type { LlmAccount } from "./accounts";
import { createCompleteFn } from "./complete";
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
      | { onPayload?: (payload: unknown) => unknown }
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
    expect(captured?.onPayload?.({
      model: "custom-model",
      store: false,
      max_output_tokens: 8_192,
      prompt_cache_key: "session",
    })).toEqual({ model: "custom-model" });
  });
});
