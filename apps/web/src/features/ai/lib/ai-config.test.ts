import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

import {
  DEFAULT_CUSTOM_OPENAI_API,
  LEGACY_CUSTOM_OPENAI_API,
  READAWARE_MODEL_IDS,
} from "@read-aware/agent";
import {
  DEFAULT_MODELS,
  DEFAULT_THINKING_LEVEL,
  getStoredProviderSettings,
  SUBSCRIPTION_MODELS,
  saveAIConfig,
} from "./ai-config";
import { hydrateSecrets } from "../../../platform/secret-store";

beforeAll(() => hydrateSecrets());
beforeEach(() => storage.clear());

describe("AI provider defaults", () => {
  test("links Fast to Smart and enables thinking for a new provider", () => {
    expect(getStoredProviderSettings("openai")).toMatchObject({
      model: DEFAULT_MODELS.openai,
      fastModel: DEFAULT_MODELS.openai,
      thinkingLevel: DEFAULT_THINKING_LEVEL,
      fastThinkingLevel: DEFAULT_THINKING_LEVEL,
    });
  });

  test("keeps legacy model tiers and their implicit Off thinking", () => {
    storage.set(
      "read-aware-ai-config",
      JSON.stringify({
        provider: "openai",
        model: "gpt-4o",
        fastModel: "gpt-4o-mini",
      }),
    );

    expect(getStoredProviderSettings("openai")).toMatchObject({
      model: "gpt-4o",
      fastModel: "gpt-4o-mini",
      thinkingLevel: "off",
      fastThinkingLevel: "off",
    });
  });

  test("persists an explicit thinking opt-out", () => {
    saveAIConfig({
      provider: "openai",
      apiKey: "",
      model: DEFAULT_MODELS.openai,
      thinkingLevel: "off",
      fastThinkingLevel: "off",
    });

    expect(getStoredProviderSettings("openai")).toMatchObject({
      fastModel: DEFAULT_MODELS.openai,
      thinkingLevel: "off",
      fastThinkingLevel: "off",
    });
  });

  test("keeps one thinking effort when Fast follows the primary model", () => {
    saveAIConfig({
      provider: "openai",
      apiKey: "",
      model: DEFAULT_MODELS.openai,
      thinkingLevel: "high",
      fastThinkingLevel: "off",
    });

    expect(getStoredProviderSettings("openai")).toMatchObject({
      model: DEFAULT_MODELS.openai,
      fastModel: DEFAULT_MODELS.openai,
      thinkingLevel: "high",
      fastThinkingLevel: "high",
    });
  });

  test("preserves two efforts for distinct model tiers", () => {
    saveAIConfig({
      provider: "openai",
      apiKey: "",
      model: DEFAULT_MODELS.openai,
      fastModel: "chosen-fast-model",
      thinkingLevel: "high",
      fastThinkingLevel: "low",
    });

    expect(getStoredProviderSettings("openai")).toMatchObject({
      model: DEFAULT_MODELS.openai,
      fastModel: "chosen-fast-model",
      thinkingLevel: "high",
      fastThinkingLevel: "low",
    });
  });

  test("defaults a new Custom provider to Chat Completions", () => {
    expect(getStoredProviderSettings("custom")).toMatchObject({
      customApi: DEFAULT_CUSTOM_OPENAI_API,
      customSupportsThinking: false,
    });
    expect(
      getStoredProviderSettings("custom").customMaxOutputTokens,
    ).toBeUndefined();
  });

  test("keeps legacy Custom providers on their previous Responses path", () => {
    storage.set(
      "read-aware-ai-config",
      JSON.stringify({
        provider: "custom",
        model: "gateway-model",
        customBaseUrl: "https://gateway.example/v1",
      }),
    );

    expect(getStoredProviderSettings("custom")).toMatchObject({
      model: "gateway-model",
      customBaseUrl: "https://gateway.example/v1",
      customApi: LEGACY_CUSTOM_OPENAI_API,
      customSupportsThinking: false,
    });
  });

  test("migrates a remembered Custom provider map to Responses", () => {
    storage.set(
      "read-aware-ai-config",
      JSON.stringify({
        provider: "openai",
        models: {
          custom: {
            model: "gateway-model",
            customBaseUrl: "https://gateway.example/v1",
          },
        },
      }),
    );

    expect(getStoredProviderSettings("custom").customApi).toBe(
      LEGACY_CUSTOM_OPENAI_API,
    );
  });

  test("persists Custom compatibility controls", () => {
    saveAIConfig({
      provider: "custom",
      apiKey: "",
      model: "gateway-model",
      customBaseUrl: "https://gateway.example/v1/chat/completions/",
      customApi: "openai-responses",
      customSupportsThinking: true,
      customMaxOutputTokens: 4_096,
    });

    expect(getStoredProviderSettings("custom")).toMatchObject({
      model: "gateway-model",
      customBaseUrl: "https://gateway.example/v1",
      customApi: "openai-responses",
      customSupportsThinking: true,
      customMaxOutputTokens: 4_096,
    });
  });
});

describe("model selection contracts", () => {
  test("does not preselect BYO models from a bundled inventory", () => {
    for (const [provider, model] of Object.entries(DEFAULT_MODELS)) {
      if (provider !== "readaware") expect(model).toBe("");
    }
  });

  test("the readaware options mirror the subscription service contract", () => {
    expect(SUBSCRIPTION_MODELS.map((option) => option.value)).toEqual([...READAWARE_MODEL_IDS]);
  });

  test("keeps each provider's selected primary and fast model when switching", () => {
    saveAIConfig({ provider: "zai-coding-cn", apiKey: "", model: "glm-my-choice", fastModel: "glm-my-fast-choice" });
    saveAIConfig({ provider: "openai", apiKey: "", model: "my-openai-choice" });
    expect(getStoredProviderSettings("zai-coding-cn")).toMatchObject({
      model: "glm-my-choice", fastModel: "glm-my-fast-choice",
    });
  });
});

describe("OpenRouter routing preferences", () => {
  test("round-trips through save with slugs sanitized to lowercase", () => {
    saveAIConfig({
      provider: "openrouter",
      apiKey: "",
      model: "deepseek/deepseek-v4-flash",
      openRouterRouting: {
        sort: "throughput",
        order: ["  CoreWeave ", "DeepInfra", ""],
        allowFallbacks: false,
      },
    });
    expect(getStoredProviderSettings("openrouter").openRouterRouting).toEqual({
      sort: "throughput",
      order: ["coreweave", "deepinfra"],
      allowFallbacks: false,
    });
  });

  test("an empty preference normalizes away instead of persisting noise", () => {
    saveAIConfig({
      provider: "openrouter",
      apiKey: "",
      model: "deepseek/deepseek-v4-flash",
      openRouterRouting: { order: [], allowFallbacks: true },
    });
    expect(getStoredProviderSettings("openrouter").openRouterRouting).toBeUndefined();
  });

  test("non-OpenRouter providers never carry a routing preference", () => {
    saveAIConfig({
      provider: "deepseek",
      apiKey: "",
      model: "deepseek-v4-flash",
      openRouterRouting: { order: ["coreweave"] },
    });
    expect(getStoredProviderSettings("deepseek").openRouterRouting).toBeUndefined();
  });
});
