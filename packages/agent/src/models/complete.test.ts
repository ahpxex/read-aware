import { describe, expect, test } from "bun:test";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import type { LlmAccount } from "./accounts";
import { createCompleteFn } from "./complete";
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
});
