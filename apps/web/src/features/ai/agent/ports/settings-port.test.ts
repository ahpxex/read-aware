import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { AgentSettingDescriptor } from "@read-aware/agent";
import { getDefaultStore } from "jotai";
import { hydrateSecrets } from "../../../../platform/secret-store";
import {
  aiPreferencesAtom,
  appSettingsAtom,
  generalSettingsAtom,
  readerOverridesAtom,
  readerPreferencesAtom,
} from "../../../../state/ui";
import type {
  RegisteredHeaderAction,
  RegisteredPluginTheme,
} from "../../../plugins/lib/plugin-types";
import {
  headerActionsAtom,
  installedPluginsAtom,
  pluginFontsAtom,
  pluginThemesAtom,
  selectionActionsAtom,
} from "../../../plugins/state/plugin-store";
import type { InstalledPlugin } from "../../../plugins/lib/plugin-types";
import { readPluginSettingsValues } from "../../../plugins/lib/plugin-settings";
import {
  CORE_MENU_DEFAULTS,
  menuConfigAtom,
} from "../../../menus/state/menu-config";
import { DEFAULT_AI_PREFERENCES } from "../../../settings/lib/ai-preferences";
import { DEFAULT_APP_SETTINGS } from "../../../settings/lib/app-settings";
import { DEFAULT_GENERAL_SETTINGS } from "../../../settings/lib/general-settings";
import { DEFAULT_READER_PREFERENCES } from "../../../settings/lib/reader-settings";
import { clearAIConfig, getAIConfig, saveAIConfig } from "../../lib/ai-config";
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
  writable: true,
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

function setting(
  settings: AgentSettingDescriptor[],
  path: string,
): AgentSettingDescriptor {
  const match = settings.find((candidate) => candidate.path === path);
  if (!match) throw new Error(`missing setting: ${path}`);
  return match;
}

beforeAll(() => hydrateSecrets());

beforeEach(() => {
  storage.clear();
  clearAIConfig();
  const store = getDefaultStore();
  store.set(generalSettingsAtom, { ...DEFAULT_GENERAL_SETTINGS });
  store.set(appSettingsAtom, { ...DEFAULT_APP_SETTINGS });
  store.set(readerPreferencesAtom, { ...DEFAULT_READER_PREFERENCES });
  store.set(readerOverridesAtom, {});
  store.set(pluginThemesAtom, []);
  store.set(pluginFontsAtom, []);
  store.set(headerActionsAtom, []);
  store.set(selectionActionsAtom, []);
  store.set(installedPluginsAtom, []);
  store.set(menuConfigAtom, {
    primaryNav: {
      visible: ["core:library", "core:agent"],
      overflow: ["core:stats"],
    },
    shelfHeader: {
      visible: [...CORE_MENU_DEFAULTS.shelfHeader],
      overflow: [],
    },
    readerHeader: {
      visible: [...CORE_MENU_DEFAULTS.readerHeader],
      overflow: [],
    },
    selection: { visible: [...CORE_MENU_DEFAULTS.selection], overflow: [] },
  });
  store.set(aiPreferencesAtom, {
    ...DEFAULT_AI_PREFERENCES,
    features: { ...DEFAULT_AI_PREFERENCES.features },
  });
});

describe("agent settings port", () => {
  test("builds a generic catalog with dynamic choices for each setting", async () => {
    getDefaultStore().set(pluginThemesAtom, [GUTENBERG, CHROME_ONLY]);

    const snapshot = await createSettingsPort().getSettings();
    const appTheme = setting(snapshot.settings, "appearance.theme");
    const readerTheme = setting(snapshot.settings, "reading.theme");

    expect(appTheme.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "plugin:editorial-themes:gutenberg",
          source: "plugin",
        }),
        expect.objectContaining({
          value: "plugin:editorial-themes:chrome-only",
          source: "plugin",
        }),
      ]),
    );
    expect(readerTheme.options).toContainEqual(
      expect.objectContaining({
        value: "plugin:editorial-themes:gutenberg",
        source: "plugin",
      }),
    );
    expect(readerTheme.options).not.toContainEqual(
      expect.objectContaining({ value: "plugin:editorial-themes:chrome-only" }),
    );
    expect(readerTheme.supportedTargets).toEqual([
      "global",
      "all-books",
      "book",
    ]);
  });

  test("applies plugin choices through ordinary path/value operations", async () => {
    const store = getDefaultStore();
    store.set(pluginThemesAtom, [GUTENBERG]);

    const result = await createSettingsPort().updateSettings([
      {
        path: "appearance.theme",
        value: "plugin:editorial-themes:gutenberg",
      },
      {
        path: "reading.theme",
        value: "plugin:editorial-themes:gutenberg",
        target: { kind: "global" },
      },
    ]);

    expect(store.get(appSettingsAtom).theme).toBe(
      "plugin:editorial-themes:gutenberg",
    );
    expect(store.get(readerPreferencesAtom)).toMatchObject({
      theme: "plugin:editorial-themes:gutenberg",
      fontFamily: "plugin:editorial-themes:eb-garamond",
      fontSize: "large",
      lineSpacing: "relaxed",
    });
    expect(result.changed).toEqual([
      {
        path: "appearance.theme",
        value: "plugin:editorial-themes:gutenberg",
        target: { kind: "global" },
      },
      {
        path: "reading.theme",
        value: "plugin:editorial-themes:gutenberg",
        target: { kind: "global" },
      },
    ]);
  });

  test("applies the same reading path to global, book, and all-books targets", async () => {
    const store = getDefaultStore();
    store.set(readerOverridesAtom, {
      "book-1": {
        scope: "book",
        settings: { ...DEFAULT_READER_PREFERENCES, fontSize: "small" },
      },
      "book-2": {
        scope: "global",
        settings: { ...DEFAULT_READER_PREFERENCES, fontSize: "x-small" },
      },
    });
    const port = createSettingsPort();

    await port.updateSettings([
      {
        path: "reading.fontSize",
        value: "large",
        target: { kind: "book", bookId: "book-1" },
      },
    ]);
    expect(store.get(readerPreferencesAtom).fontSize).toBe(
      DEFAULT_READER_PREFERENCES.fontSize,
    );
    expect(store.get(readerOverridesAtom)["book-1"]?.settings.fontSize).toBe(
      "large",
    );

    const bookSnapshot = await port.getSettings({
      section: "reading",
      target: { kind: "book", bookId: "book-1" },
    });
    expect(setting(bookSnapshot.settings, "reading.fontSize").value).toBe(
      "large",
    );
    expect(bookSnapshot.overrides).toContainEqual(
      expect.objectContaining({ target: { kind: "book", bookId: "book-1" } }),
    );

    await port.updateSettings([
      {
        path: "reading.lineSpacing",
        value: "relaxed",
        target: { kind: "all-books" },
      },
    ]);
    expect(store.get(readerPreferencesAtom).lineSpacing).toBe("relaxed");
    expect(store.get(readerOverridesAtom)["book-1"]?.settings.lineSpacing).toBe(
      "relaxed",
    );
    expect(store.get(readerOverridesAtom)["book-2"]?.settings.lineSpacing).toBe(
      "relaxed",
    );
  });

  test("requires an explicit target for every scoped reading setting", async () => {
    await expect(
      createSettingsPort().updateSettings([
        { path: "reading.fontSize", value: "large" },
      ]),
    ).rejects.toThrow(
      "reading.fontSize requires an explicit target: global, all-books, book",
    );
    expect(getDefaultStore().get(readerPreferencesAtom).fontSize).toBe(
      DEFAULT_READER_PREFERENCES.fontSize,
    );
  });

  test("reports global changes that can be shadowed by book overrides", async () => {
    const store = getDefaultStore();
    store.set(readerOverridesAtom, {
      "book-1": {
        scope: "book",
        settings: { ...DEFAULT_READER_PREFERENCES, theme: "dark" },
      },
    });
    const port = createSettingsPort();

    await port.updateSettings([
      { path: "reading.theme", value: "light", target: { kind: "global" } },
    ]);

    expect(store.get(readerPreferencesAtom).theme).toBe("light");
    expect(store.get(readerOverridesAtom)["book-1"]?.settings.theme).toBe(
      "dark",
    );
    const snapshot = await port.getSettings({ section: "reading" });
    expect(snapshot.overrides).toContainEqual({
      target: { kind: "book", bookId: "book-1" },
      paths: expect.arrayContaining(["reading.theme", "reading.fontSize"]),
    });
  });

  test("rejects invalid choices and unsupported targets atomically", async () => {
    const store = getDefaultStore();
    store.set(pluginThemesAtom, [CHROME_ONLY]);
    const port = createSettingsPort();

    await expect(
      port.updateSettings([
        { path: "appearance.theme", value: "dark" },
        {
          path: "reading.theme",
          value: "plugin:editorial-themes:chrome-only",
          target: { kind: "global" },
        },
      ]),
    ).rejects.toThrow("reading.theme must be one of");
    expect(store.get(appSettingsAtom).theme).toBe("system");

    await expect(
      port.updateSettings([
        {
          path: "appearance.motion",
          value: "reduced",
          target: { kind: "book", bookId: "book-1" },
        },
      ]),
    ).rejects.toThrow("appearance.motion does not support target book");
  });

  test("canonicalizes book targets before duplicate detection", async () => {
    await expect(
      createSettingsPort().updateSettings([
        {
          path: "reading.fontSize",
          value: "large",
          target: { kind: "book", bookId: "book-1" },
        },
        {
          path: "reading.fontSize",
          value: "small",
          target: { kind: "book", bookId: " book-1 " },
        },
      ]),
    ).rejects.toThrow(
      "duplicate settings change: reading.fontSize@book:book-1",
    );
    expect(getDefaultStore().get(readerOverridesAtom)).toEqual({});
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

    const snapshot = await createSettingsPort().getSettings({ section: "ai" });
    expect(setting(snapshot.settings, "ai.connection.configured").value).toBe(
      true,
    );
    expect(
      setting(snapshot.settings, "ai.connection.credentialConfigured").value,
    ).toBe(true);
    expect(setting(snapshot.settings, "ai.connection.provider")).toMatchObject({
      value: "custom",
      writable: false,
    });
    expect(
      setting(snapshot.settings, "ai.connection.custom.endpointConfigured")
        .value,
    ).toBe(true);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("secret-test-key");
    expect(serialized).not.toContain("private-gateway.example");
    expect(serialized).not.toContain("customBaseUrl");
  });

  test("updates safe AI preferences while preserving credential routing", async () => {
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

    await createSettingsPort().updateSettings([
      { path: "general.startView", value: "resume" },
      { path: "appearance.theme", value: "dark" },
      {
        path: "reading.fontFamily",
        value: "curated:literata",
        target: { kind: "global" },
      },
      {
        path: "reading.fontSize",
        value: "large",
        target: { kind: "global" },
      },
      { path: "ai.preferences.followStreaming", value: true },
      { path: "ai.connection.primaryModel", value: "gateway-model-v2" },
      { path: "ai.connection.fastModel", value: null },
      { path: "ai.connection.thinkingLevel", value: "high" },
      { path: "ai.connection.custom.maxOutputTokens", value: null },
    ]);

    const store = getDefaultStore();
    expect(store.get(generalSettingsAtom).startView).toBe("resume");
    expect(store.get(appSettingsAtom).theme).toBe("dark");
    expect(store.get(readerPreferencesAtom)).toMatchObject({
      fontFamily: "curated:literata",
      fontSize: "large",
    });
    expect(store.get(aiPreferencesAtom).followStreaming).toBe(true);
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

  test("keeps sensitive and read-only connection paths outside writes", async () => {
    saveAIConfig({
      provider: "openai",
      apiKey: "secret-test-key",
      model: "gpt-5.5",
    });
    const port = createSettingsPort();

    await expect(
      port.updateSettings([{ path: "ai.connection.apiKey", value: "stolen" }]),
    ).rejects.toThrow("unknown or read-only setting");
    await expect(
      port.updateSettings([
        { path: "ai.connection.provider", value: "custom" },
      ]),
    ).rejects.toThrow("unknown or read-only setting");
    expect(getAIConfig()).toMatchObject({
      provider: "openai",
      apiKey: "secret-test-key",
    });
  });

  test("exposes Fast effort only while a separate Fast model is active", async () => {
    saveAIConfig({
      provider: "openai",
      apiKey: "secret-test-key",
      model: "gpt-5.5",
      thinkingLevel: "medium",
    });

    const port = createSettingsPort();
    const initial = await port.getSettings({ section: "ai" });
    expect(
      initial.settings.some(
        (candidate) => candidate.path === "ai.connection.fastThinkingLevel",
      ),
    ).toBe(false);

    await expect(
      port.updateSettings([
        { path: "appearance.theme", value: "dark" },
        { path: "ai.connection.fastThinkingLevel", value: "low" },
      ]),
    ).rejects.toThrow("unknown or read-only setting");
    expect(getDefaultStore().get(appSettingsAtom).theme).toBe("system");

    await port.updateSettings([
      { path: "ai.connection.fastModel", value: "gpt-5.5-mini" },
    ]);
    const separate = await port.getSettings({ section: "ai" });
    expect(
      setting(separate.settings, "ai.connection.fastThinkingLevel").value,
    ).toBe("medium");
    await port.updateSettings([
      { path: "ai.connection.fastThinkingLevel", value: "low" },
    ]);
    expect(getAIConfig()?.fastThinkingLevel).toBe("low");
  });
});

const DICTIONARY_PAGE = {
  key: "dictionary:vocabulary",
  pluginId: "dictionary",
  pluginName: "Dictionary",
  id: "vocabulary",
  title: "Vocabulary",
  surface: "shelf",
  presentation: "page",
  view: async () => ({ kind: "list", items: [] }),
} as unknown as RegisteredHeaderAction;

describe("agent menu settings", () => {
  test("exposes resolved menu layouts with plugin destinations as options", async () => {
    getDefaultStore().set(headerActionsAtom, [DICTIONARY_PAGE]);
    const port = createSettingsPort();
    const snapshot = await port.getSettings({ section: "menus" });

    const visible = setting(snapshot.settings, "menus.primaryNav.visible");
    expect(visible.kind).toBe("id-list");
    expect(visible.value).toEqual(["core:library", "core:agent"]);
    expect(visible.options?.map((option) => option.value)).toContain(
      "plugin:dictionary:vocabulary",
    );
    // Unplaced plugin destinations resolve into the overflow zone.
    const overflow = setting(snapshot.settings, "menus.primaryNav.overflow");
    expect(overflow.value).toEqual([
      "core:stats",
      "plugin:dictionary:vocabulary",
    ]);
  });

  test("hides a destination by writing the visible list without it", async () => {
    const store = getDefaultStore();
    store.set(headerActionsAtom, [DICTIONARY_PAGE]);
    store.set(menuConfigAtom, {
      ...store.get(menuConfigAtom),
      primaryNav: {
        visible: ["core:library", "core:agent", "plugin:dictionary:vocabulary"],
        overflow: ["core:stats"],
      },
    });

    const port = createSettingsPort();
    const result = await port.updateSettings([
      {
        path: "menus.primaryNav.visible",
        value: ["core:library", "core:agent"],
      },
    ]);

    expect(result.changed).toHaveLength(1);
    const layout = store.get(menuConfigAtom).primaryNav;
    expect(layout.visible).toEqual(["core:library", "core:agent"]);
    // The hidden destination lands in overflow instead of limbo.
    expect(layout.overflow).toContain("plugin:dictionary:vocabulary");
  });

  test("enforces the primary navigation surface rules", async () => {
    const port = createSettingsPort();
    await expect(
      port.updateSettings([
        { path: "menus.primaryNav.visible", value: [] },
      ]),
    ).rejects.toThrow(/at least 1/);
    await expect(
      port.updateSettings([
        {
          path: "menus.primaryNav.visible",
          value: ["core:library", "core:not-a-thing"],
        },
      ]),
    ).rejects.toThrow(/unknown ids/);
    // Moving everything out through the overflow side is equally rejected.
    await expect(
      port.updateSettings([
        {
          path: "menus.primaryNav.overflow",
          value: ["core:library", "core:agent", "core:stats"],
        },
      ]),
    ).rejects.toThrow(/fewer than 1/);
  });
});

const RSS_PLUGIN: InstalledPlugin = {
  enabled: true,
  manifest: {
    id: "rss-reader",
    name: "RSS Reader",
    version: "0.5.0",
    settings: [
      {
        kind: "number",
        id: "articleLimit",
        label: "Articles per feed",
        value: 30,
        min: 5,
        max: 100,
        step: 5,
      },
      {
        kind: "text",
        id: "proxyToken",
        label: "Proxy token",
        inputMode: "password",
      },
      {
        kind: "toggle",
        id: "debugMode",
        label: "Debug mode",
        value: false,
        agentHidden: true,
      },
    ],
  },
};

describe("agent plugin settings", () => {
  test("exposes declared fields of enabled plugins, minus hidden ones", async () => {
    getDefaultStore().set(installedPluginsAtom, [RSS_PLUGIN]);
    const port = createSettingsPort();
    const snapshot = await port.getSettings({ section: "plugins" });

    const limit = setting(snapshot.settings, "plugins.rss-reader.articleLimit");
    expect(limit.kind).toBe("number");
    expect(limit.value).toBe(30);
    const paths = snapshot.settings.map((entry) => entry.path);
    // Password fields and agentHidden fields never reach the agent.
    expect(paths).not.toContain("plugins.rss-reader.proxyToken");
    expect(paths).not.toContain("plugins.rss-reader.debugMode");
  });

  test("writes through the shared plugin-settings store with validation", async () => {
    getDefaultStore().set(installedPluginsAtom, [RSS_PLUGIN]);
    const port = createSettingsPort();

    await expect(
      port.updateSettings([
        { path: "plugins.rss-reader.articleLimit", value: 500 },
      ]),
    ).rejects.toThrow(/at most 100/);

    const result = await port.updateSettings([
      { path: "plugins.rss-reader.articleLimit", value: 50 },
    ]);
    expect(result.changed).toHaveLength(1);
    // The same object the plugin reads through its Storage host service.
    expect(readPluginSettingsValues("rss-reader").articleLimit).toBe(50);
  });

  test("disabled plugins drop out of the catalog", async () => {
    getDefaultStore().set(installedPluginsAtom, [
      { ...RSS_PLUGIN, enabled: false },
    ]);
    const port = createSettingsPort();
    const snapshot = await port.getSettings({ section: "plugins" });
    expect(snapshot.settings).toHaveLength(0);
  });
});
