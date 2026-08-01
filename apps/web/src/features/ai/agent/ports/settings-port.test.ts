import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { getDefaultStore } from "jotai";
import {
  aiPreferencesAtom,
  appSettingsAtom,
  generalSettingsAtom,
  readerPreferencesAtom,
} from "../../../../state/ui";
import type { RegisteredPluginTheme } from "../../../plugins/lib/plugin-types";
import { pluginThemesAtom } from "../../../plugins/state/plugin-store";
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

const GUTENBERG: RegisteredPluginTheme = {
  key: "editorial-themes:gutenberg",
  pluginId: "editorial-themes",
  pluginName: "Editorial Themes",
  id: "gutenberg",
  name: "Gutenberg",
  polarity: "light",
  app: { paper: "#f4ecd9" },
  reader: {
    palette: {
      bg: "#f3ead5",
      text: "#2b241a",
      selection: "rgba(151, 129, 83, 0.32)",
      rule: "rgba(43, 36, 26, 0.16)",
      faint: "rgba(43, 36, 26, 0.05)",
      muted: "rgba(43, 36, 26, 0.55)",
    },
    typography: {
      fontFamily: "plugin:editorial-themes:eb-garamond",
      fontSize: "large",
      lineSpacing: "relaxed",
    },
  },
};

const CHROME_ONLY: RegisteredPluginTheme = {
  key: "editorial-themes:chrome-only",
  pluginId: "editorial-themes",
  pluginName: "Editorial Themes",
  id: "chrome-only",
  name: "Chrome Only",
  polarity: "dark",
  app: { paper: "#14171e" },
};

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
  store.set(pluginThemesAtom, []);
  store.set(aiPreferencesAtom, {
    ...DEFAULT_AI_PREFERENCES,
    features: { ...DEFAULT_AI_PREFERENCES.features },
  });
});

describe("agent settings port", () => {
  test("discovers enabled plugin themes on each supported surface", async () => {
    getDefaultStore().set(pluginThemesAtom, [GUTENBERG, CHROME_ONLY]);

    const settings = await createSettingsPort().getSettings();

    expect(settings.appearance.availableThemes).toEqual(
      expect.arrayContaining([
        {
          value: "plugin:editorial-themes:gutenberg",
          label: "Gutenberg",
          source: "plugin",
          pluginName: "Editorial Themes",
          polarity: "light",
        },
        {
          value: "plugin:editorial-themes:chrome-only",
          label: "Chrome Only",
          source: "plugin",
          pluginName: "Editorial Themes",
          polarity: "dark",
        },
      ]),
    );
    expect(settings.reading.availableThemes).toContainEqual({
      value: "plugin:editorial-themes:gutenberg",
      label: "Gutenberg",
      source: "plugin",
      pluginName: "Editorial Themes",
      polarity: "light",
    });
    expect(settings.reading.availableThemes).not.toContainEqual(
      expect.objectContaining({ value: "plugin:editorial-themes:chrome-only" }),
    );
  });

  test("applies registered plugin themes and their reader typography preset", async () => {
    const store = getDefaultStore();
    store.set(pluginThemesAtom, [GUTENBERG]);

    const result = await createSettingsPort().updateSettings({
      appearance: { theme: "plugin:editorial-themes:gutenberg" },
      reading: { theme: "plugin:editorial-themes:gutenberg" },
    });

    expect(store.get(appSettingsAtom).theme).toBe(
      "plugin:editorial-themes:gutenberg",
    );
    expect(store.get(readerPreferencesAtom)).toMatchObject({
      theme: "plugin:editorial-themes:gutenberg",
      fontFamily: "plugin:editorial-themes:eb-garamond",
      fontSize: "large",
      lineSpacing: "relaxed",
    });
    expect(result.changed).toEqual(
      expect.arrayContaining([
        "appearance.theme",
        "reading.theme",
        "reading.fontFamily",
        "reading.fontSize",
        "reading.lineSpacing",
      ]),
    );
    expect(result.changed).not.toContain("appearance.availableThemes");
    expect(result.changed).not.toContain("reading.availableThemes");
  });

  test("rejects unavailable or wrong-surface plugin themes before any write", async () => {
    const store = getDefaultStore();
    store.set(pluginThemesAtom, [CHROME_ONLY]);

    await expect(
      createSettingsPort().updateSettings({
        appearance: { theme: "dark" },
        reading: { theme: "plugin:editorial-themes:chrome-only" },
      }),
    ).rejects.toThrow("unknown reader theme");

    expect(store.get(appSettingsAtom).theme).toBe("system");
    expect(store.get(readerPreferencesAtom).theme).toBe(
      DEFAULT_READER_PREFERENCES.theme,
    );
  });

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
