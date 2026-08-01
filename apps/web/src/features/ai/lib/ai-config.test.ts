import { beforeEach, describe, expect, test } from "bun:test";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

import { getProviderModelCatalog, type KnownProviderId } from "@read-aware/agent";
import {
  DEFAULT_MODELS,
  DEFAULT_THINKING_LEVEL,
  getStoredProviderSettings,
  PROVIDER_MODELS,
  saveAIConfig,
  SUGGESTED_FAST_MODELS,
  type AIProvider,
} from "./ai-config";

const catalogProviders = Object.keys(PROVIDER_MODELS).filter(
  (provider): provider is KnownProviderId => provider !== "custom",
);

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
});
