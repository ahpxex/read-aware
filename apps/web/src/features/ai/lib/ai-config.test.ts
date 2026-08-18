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
  getProviderModelCatalog,
  type KnownProviderId,
} from "@read-aware/agent";
import {
  DEFAULT_MODELS,
  DEFAULT_THINKING_LEVEL,
  getStoredProviderSettings,
  PROVIDER_MODELS,
  saveAIConfig,
  SUGGESTED_FAST_MODELS,
  type AIProvider,
} from "./ai-config";
import { hydrateSecrets } from "../../../platform/secret-store";

// "custom" has no catalog at all; "readaware" is cataloged by the relay
// proxy, not pi-ai — it gets its own assertion below.
const catalogProviders = Object.keys(PROVIDER_MODELS).filter(
  (provider): provider is KnownProviderId =>
    provider !== "custom" && provider !== "readaware",
);

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
      fastModel: SUGGESTED_FAST_MODELS.openai,
      thinkingLevel: "high",
      fastThinkingLevel: "low",
    });

    expect(getStoredProviderSettings("openai")).toMatchObject({
      model: DEFAULT_MODELS.openai,
      fastModel: SUGGESTED_FAST_MODELS.openai,
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

describe("recommended model options", () => {
  test("are current entries from pi-ai's provider catalog", () => {
    for (const provider of catalogProviders) {
      const sdkIds = new Set(getProviderModelCatalog(provider).map((model) => model.id));
      const optionIds = PROVIDER_MODELS[provider].map((option) => option.value);

      expect(optionIds.length).toBeGreaterThan(0);
      expect(optionIds.every((id) => sdkIds.has(id))).toBe(true);
      expect(optionIds).toContain(DEFAULT_MODELS[provider as AIProvider]);
      expect(optionIds).toContain(SUGGESTED_FAST_MODELS[provider as AIProvider]);
    }
  });

  test("the readaware options mirror the agent's subscription catalog", () => {
    const optionIds = PROVIDER_MODELS.readaware.map((option) => option.value);
    expect(optionIds).toEqual([...READAWARE_MODEL_IDS]);
    expect(optionIds).toContain(DEFAULT_MODELS.readaware);
    expect(optionIds).toContain(SUGGESTED_FAST_MODELS.readaware);
  });
});
