import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { getDefaultStore } from "jotai";
import {
  aiPreferencesAtom,
  appSettingsAtom,
  generalSettingsAtom,
  readerPreferencesAtom,
} from "../../../../state/ui";
import { DEFAULT_AI_PREFERENCES } from "../../../settings/lib/ai-preferences";
import { DEFAULT_APP_SETTINGS } from "../../../settings/lib/app-settings";
import { DEFAULT_GENERAL_SETTINGS } from "../../../settings/lib/general-settings";
import { DEFAULT_READER_PREFERENCES } from "../../../settings/lib/reader-settings";
import { hydrateSecrets } from "../../../../platform/secret-store";
import {
  clearAIConfig,
  getAIConfig,
  saveAIConfig,
} from "../../lib/ai-config";
import { createSettingsPort } from "./settings-port";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
  },
});

beforeAll(() => hydrateSecrets());

beforeEach(() => {
  storage.clear();
  clearAIConfig();
  const store = getDefaultStore();
  store.set(generalSettingsAtom, { ...DEFAULT_GENERAL_SETTINGS });
  store.set(appSettingsAtom, { ...DEFAULT_APP_SETTINGS });
  store.set(readerPreferencesAtom, { ...DEFAULT_READER_PREFERENCES });
  store.set(aiPreferencesAtom, {
    ...DEFAULT_AI_PREFERENCES,
    features: { ...DEFAULT_AI_PREFERENCES.features },
  });
});

describe("agent settings port", () => {
  test("reports connection state without exposing the key or endpoint", async () => {
    saveAIConfig({
      provider: "custom",
      apiKey: "secret-test-key",
      model: "gateway-model",
      customBaseUrl: "https://private-gateway.example/v1",
      customApi: "openai-completions",
      customSupportsThinking: true,
    });

    const settings = await createSettingsPort().getSettings();
    expect(settings.ai.connection).toMatchObject({
      configured: true,
      credentialConfigured: true,
      provider: "custom",
      primaryModel: "gateway-model",
      custom: {
        endpointConfigured: true,
        api: "openai-completions",
        supportsThinking: true,
      },
    });
    const serialized = JSON.stringify(settings);
    expect(serialized).not.toContain("secret-test-key");
    expect(serialized).not.toContain("private-gateway.example");
    expect(serialized).not.toContain("customBaseUrl");
  });

  test("applies live preferences and preserves credential routing", async () => {
    saveAIConfig({
      provider: "custom",
      apiKey: "secret-test-key",
      model: "gateway-model",
      thinkingLevel: "medium",
      customBaseUrl: "https://private-gateway.example/v1",
      customApi: "openai-completions",
      customSupportsThinking: true,
      customMaxOutputTokens: 8_192,
    });

    const result = await createSettingsPort().updateSettings({
      general: { startView: "resume" },
      appearance: { theme: "dark" },
      reading: { fontFamily: "curated:literata", fontSize: "large" },
      ai: {
        preferences: { followStreaming: true },
        connection: {
          primaryModel: "gateway-model-v2",
          fastModel: null,
          thinkingLevel: "high",
          customMaxOutputTokens: null,
        },
      },
    });

    const store = getDefaultStore();
    expect(store.get(generalSettingsAtom).startView).toBe("resume");
    expect(store.get(appSettingsAtom).theme).toBe("dark");
    expect(store.get(readerPreferencesAtom)).toMatchObject({
      fontFamily: "curated:literata",
      fontSize: "large",
    });
    expect(store.get(aiPreferencesAtom).followStreaming).toBe(true);
    expect(result.changed).toEqual(
      expect.arrayContaining([
        "general.startView",
        "appearance.theme",
        "reading.fontFamily",
        "reading.fontSize",
        "ai.preferences.followStreaming",
        "ai.connection.primaryModel",
        "ai.connection.fastModel",
        "ai.connection.thinkingLevel",
        "ai.connection.fastThinkingLevel",
        "ai.connection.custom.maxOutputTokens",
      ]),
    );

    expect(getAIConfig()).toMatchObject({
      provider: "custom",
      apiKey: "secret-test-key",
      model: "gateway-model-v2",
      fastModel: "gateway-model-v2",
      thinkingLevel: "high",
      fastThinkingLevel: "high",
      customBaseUrl: "https://private-gateway.example/v1",
    });
    expect(getAIConfig()?.customMaxOutputTokens).toBeUndefined();
  });

  test("rejects invalid Fast effort before applying any other setting", async () => {
    saveAIConfig({
      provider: "openai",
      apiKey: "secret-test-key",
      model: "gpt-5.5",
      thinkingLevel: "medium",
    });

    await expect(
      createSettingsPort().updateSettings({
        appearance: { theme: "dark" },
        ai: { connection: { fastThinkingLevel: "low" } },
      }),
    ).rejects.toThrow("fastThinkingLevel requires a separate Fast model");
    expect(getDefaultStore().get(appSettingsAtom).theme).toBe("system");
  });

  test("does not allow Custom transport controls on a built-in provider", async () => {
    saveAIConfig({
      provider: "openai",
      apiKey: "secret-test-key",
      model: "gpt-5.5",
    });

    await expect(
      createSettingsPort().updateSettings({
        ai: { connection: { customApi: "openai-responses" } },
      }),
    ).rejects.toThrow("Custom compatibility settings require the active Custom provider");
  });
});
