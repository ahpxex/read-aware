import type {
  AgentSettingsPatch,
  AgentSettingsSnapshot,
  AgentSettingsUpdateResult,
  SettingsPort,
  ThinkingLevel,
} from "@read-aware/agent";
import { getDefaultStore } from "jotai";
import { setLocale } from "../../../../i18n";
import { detectInitialLocale } from "../../../../i18n/detect";
import {
  aiPreferencesAtom,
  appSettingsAtom,
  generalSettingsAtom,
  readerPreferencesAtom,
} from "../../../../state/ui";
import { getCuratedFont } from "../../../settings/lib/curated-font-catalog";
import type { ReaderFontFamily } from "../../../settings/lib/reader-settings";
import {
  DEFAULT_THINKING_LEVEL,
  getAIConfig,
  saveAIConfig,
  type AIConfig,
} from "../../lib/ai-config";

const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const AI_FEATURE_KEYS = [
  "explainSelection",
  "defineTerm",
  "translate",
  "summarizeChapter",
  "askConversation",
] as const;

function assertThinkingLevel(value: ThinkingLevel): void {
  if (!THINKING_LEVELS.has(value)) throw new Error(`unsupported thinking level: ${value}`);
}

function cleanModel(value: string, field: string): string {
  const model = value.trim();
  if (!model) throw new Error(`${field} must not be empty`);
  return model;
}

function cleanFontFamily(value: string): ReaderFontFamily {
  const font = value.trim();
  if (font.startsWith("curated:")) {
    if (getCuratedFont(font.slice("curated:".length))) {
      return font as `curated:${string}`;
    }
    throw new Error(`unknown curated font: ${font}`);
  }
  if (font.startsWith("system:")) {
    const family = font.slice("system:".length).trim();
    if (family && family.length <= 120 && !/[\u0000-\u001f\u007f]/.test(family)) {
      return `system:${family}`;
    }
  }
  throw new Error(
    "fontFamily must be a supported curated font or a non-empty system:<family> value",
  );
}

function sanitizedConnection(config: AIConfig | null): AgentSettingsSnapshot["ai"]["connection"] {
  if (!config) return { configured: false, credentialConfigured: false };
  const separateFastModel = Boolean(config.fastModel && config.fastModel !== config.model);
  return {
    configured: true,
    credentialConfigured: Boolean(config.apiKey),
    provider: config.provider,
    primaryModel: config.model,
    fastModel: separateFastModel ? config.fastModel : config.model,
    separateFastModel,
    thinkingLevel: config.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
    fastThinkingLevel: separateFastModel
      ? config.fastThinkingLevel ?? DEFAULT_THINKING_LEVEL
      : config.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
    ...(config.provider === "custom"
      ? {
          custom: {
            endpointConfigured: Boolean(config.customBaseUrl),
            api: config.customApi ?? "openai-completions",
            supportsThinking: Boolean(config.customSupportsThinking),
            ...(config.customMaxOutputTokens
              ? { maxOutputTokens: config.customMaxOutputTokens }
              : {}),
          },
        }
      : {}),
  };
}

function settingsSnapshot(): AgentSettingsSnapshot {
  const store = getDefaultStore();
  const general = store.get(generalSettingsAtom);
  const appearance = store.get(appSettingsAtom);
  const reading = store.get(readerPreferencesAtom);
  const ai = store.get(aiPreferencesAtom);
  return {
    general: {
      ...general,
      language: general.language ?? detectInitialLocale(null),
    },
    appearance,
    reading,
    ai: {
      preferences: ai,
      connection: sanitizedConnection(getAIConfig()),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function changedPaths(before: unknown, after: unknown, prefix = ""): string[] {
  if (Object.is(before, after)) return [];
  if (isRecord(before) && isRecord(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((key) =>
      changedPaths(before[key], after[key], prefix ? `${prefix}.${key}` : key),
    );
  }
  return prefix ? [prefix] : [];
}

function nextAIConfig(
  config: AIConfig | null,
  patch: NonNullable<NonNullable<AgentSettingsPatch["ai"]>["connection"]>,
): AIConfig {
  if (!config) throw new Error("AI connection settings have not been configured yet");

  const primaryModel =
    patch.primaryModel === undefined
      ? config.model
      : cleanModel(patch.primaryModel, "primaryModel");
  const hadSeparateFastModel = Boolean(config.fastModel && config.fastModel !== config.model);
  let fastModel: string | undefined;
  if (patch.fastModel === null) {
    fastModel = undefined;
  } else if (patch.fastModel !== undefined) {
    const candidate = cleanModel(patch.fastModel, "fastModel");
    fastModel = candidate === primaryModel ? undefined : candidate;
  } else {
    fastModel = hadSeparateFastModel ? config.fastModel : undefined;
    if (fastModel === primaryModel) fastModel = undefined;
  }

  if (patch.thinkingLevel !== undefined) assertThinkingLevel(patch.thinkingLevel);
  if (patch.fastThinkingLevel !== undefined) {
    assertThinkingLevel(patch.fastThinkingLevel);
    if (!fastModel) {
      throw new Error("fastThinkingLevel requires a separate Fast model");
    }
  }

  const customPatchRequested =
    patch.customApi !== undefined ||
    patch.customSupportsThinking !== undefined ||
    patch.customMaxOutputTokens !== undefined;
  if (customPatchRequested && config.provider !== "custom") {
    throw new Error("Custom compatibility settings require the active Custom provider");
  }
  if (
    patch.customMaxOutputTokens !== undefined &&
    patch.customMaxOutputTokens !== null &&
    (!Number.isInteger(patch.customMaxOutputTokens) || patch.customMaxOutputTokens <= 0)
  ) {
    throw new Error("customMaxOutputTokens must be a positive integer or null");
  }

  const thinkingLevel = patch.thinkingLevel ?? config.thinkingLevel ?? DEFAULT_THINKING_LEVEL;
  return {
    ...config,
    model: primaryModel,
    fastModel,
    thinkingLevel,
    fastThinkingLevel: fastModel
      ? patch.fastThinkingLevel ?? config.fastThinkingLevel ?? thinkingLevel
      : thinkingLevel,
    ...(config.provider === "custom"
      ? {
          customApi: patch.customApi ?? config.customApi,
          customSupportsThinking:
            patch.customSupportsThinking ?? config.customSupportsThinking,
          customMaxOutputTokens:
            patch.customMaxOutputTokens === null
              ? undefined
              : patch.customMaxOutputTokens ?? config.customMaxOutputTokens,
        }
      : {}),
  };
}

function applySettingsPatch(patch: AgentSettingsPatch): AgentSettingsUpdateResult {
  const store = getDefaultStore();
  const before = settingsSnapshot();
  // Validate every fallible value before writing anything, so a mixed patch
  // cannot leave half its settings applied when one field is invalid.
  const fontFamily =
    patch.reading?.fontFamily === undefined
      ? undefined
      : cleanFontFamily(patch.reading.fontFamily);
  const aiConfig = patch.ai?.connection
    ? nextAIConfig(getAIConfig(), patch.ai.connection)
    : undefined;

  if (patch.general) {
    const current = store.get(generalSettingsAtom);
    const next = { ...current };
    if (patch.general.startView !== undefined) next.startView = patch.general.startView;
    if (patch.general.language !== undefined) next.language = patch.general.language;
    if (patch.general.crashReports !== undefined) next.crashReports = patch.general.crashReports;
    if (patch.general.launchAtStartup !== undefined) {
      next.launchAtStartup = patch.general.launchAtStartup;
    }
    if (patch.general.fileAssociations !== undefined) {
      next.fileAssociations = patch.general.fileAssociations;
    }
    if (patch.general.autoUpdate !== undefined) next.autoUpdate = patch.general.autoUpdate;
    store.set(generalSettingsAtom, next);
    if (patch.general.language !== undefined && patch.general.language !== current.language) {
      setLocale(patch.general.language);
    }
  }

  if (patch.appearance) {
    const current = store.get(appSettingsAtom);
    const next = { ...current };
    if (patch.appearance.theme !== undefined) next.theme = patch.appearance.theme;
    if (patch.appearance.motion !== undefined) next.motion = patch.appearance.motion;
    store.set(appSettingsAtom, next);
  }

  if (patch.reading) {
    const current = store.get(readerPreferencesAtom);
    const next = { ...current };
    if (patch.reading.theme !== undefined) next.theme = patch.reading.theme;
    if (fontFamily !== undefined) next.fontFamily = fontFamily;
    if (patch.reading.fontSize !== undefined) next.fontSize = patch.reading.fontSize;
    if (patch.reading.fontWeight !== undefined) next.fontWeight = patch.reading.fontWeight;
    if (patch.reading.lineSpacing !== undefined) next.lineSpacing = patch.reading.lineSpacing;
    if (patch.reading.paragraphSpacing !== undefined) {
      next.paragraphSpacing = patch.reading.paragraphSpacing;
    }
    if (patch.reading.pageMargins !== undefined) next.pageMargins = patch.reading.pageMargins;
    if (patch.reading.readingMode !== undefined) next.readingMode = patch.reading.readingMode;
    store.set(readerPreferencesAtom, next);
  }

  if (patch.ai?.preferences) {
    const current = store.get(aiPreferencesAtom);
    const prefPatch = patch.ai.preferences;
    const next = { ...current, features: { ...current.features } };
    if (prefPatch.features) {
      for (const key of AI_FEATURE_KEYS) {
        const value = prefPatch.features[key];
        if (value !== undefined) next.features[key] = value;
      }
    }
    if (prefPatch.buildMemory !== undefined) next.buildMemory = prefPatch.buildMemory;
    if (prefPatch.sendHighlightedText !== undefined) {
      next.sendHighlightedText = prefPatch.sendHighlightedText;
    }
    if (prefPatch.sendSurroundingContext !== undefined) {
      next.sendSurroundingContext = prefPatch.sendSurroundingContext;
    }
    if (prefPatch.localOnly !== undefined) next.localOnly = prefPatch.localOnly;
    if (prefPatch.followStreaming !== undefined) {
      next.followStreaming = prefPatch.followStreaming;
    }
    store.set(aiPreferencesAtom, next);
  }

  if (aiConfig) saveAIConfig(aiConfig);

  const settings = settingsSnapshot();
  return { changed: changedPaths(before, settings), settings };
}

export function createSettingsPort(): SettingsPort {
  return {
    getSettings: async () => settingsSnapshot(),
    updateSettings: async (patch) => applySettingsPatch(patch),
  };
}
