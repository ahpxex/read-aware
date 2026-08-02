import type {
  AgentSettingDescriptor,
  AgentSettingOption,
  AgentSettingValue,
  AgentSettingsQueryTarget,
  AgentSettingsSection,
  AgentSettingsTarget,
  ThinkingLevel,
} from "@read-aware/agent";
import { LOCALES, LOCALE_LABELS } from "../../../../i18n/config";
import { detectInitialLocale } from "../../../../i18n/detect";
import type {
  AppSettings,
  AppThemePreference,
} from "../../../settings/lib/app-settings";
import type { AIPreferences } from "../../../settings/lib/ai-preferences";
import { AI_FEATURE_KEYS } from "../../../settings/lib/ai-preferences";
import {
  CURATED_FONTS,
  getCuratedFont,
} from "../../../settings/lib/curated-font-catalog";
import type { GeneralSettings } from "../../../settings/lib/general-settings";
import type { ReaderOverrides } from "../../../settings/lib/reader-overrides";
import type {
  ReaderFontFamily,
  ReaderSettingsPreferences,
  ReaderThemePreference,
} from "../../../settings/lib/reader-settings";
import { applyReaderThemeSelection } from "../../../settings/lib/reader-theme";
import { contributionText } from "../../../plugins/lib/plugin-i18n";
import {
  findRegisteredByRef,
  toPluginRef,
} from "../../../plugins/lib/plugin-theme";
import type {
  RegisteredPluginFont,
  RegisteredPluginTheme,
} from "../../../plugins/lib/plugin-types";
import { DEFAULT_THINKING_LEVEL, type AIConfig } from "../../lib/ai-config";
import type { CustomOpenAIApi } from "@read-aware/agent";

export type SettingsDraft = {
  general: GeneralSettings;
  appearance: AppSettings;
  reading: ReaderSettingsPreferences;
  readerOverrides: ReaderOverrides;
  aiPreferences: AIPreferences;
  aiConfig: AIConfig | null;
  pluginThemes: RegisteredPluginTheme[];
  pluginFonts: RegisteredPluginFont[];
};

export type SettingDefinition = {
  path: string;
  section: AgentSettingsSection;
  label: string;
  description?: string;
  kind: AgentSettingDescriptor["kind"];
  nullable?: boolean;
  options?:
    AgentSettingOption[] | ((draft: SettingsDraft) => AgentSettingOption[]);
  supportedTargets?: AgentSettingsTarget["kind"][];
  read: (
    draft: SettingsDraft,
    target: AgentSettingsQueryTarget,
  ) => AgentSettingValue;
  write?: (
    draft: SettingsDraft,
    value: AgentSettingValue,
    target: AgentSettingsTarget,
  ) => void;
  validate?: (
    value: AgentSettingValue,
    draft: SettingsDraft,
  ) => AgentSettingValue;
};

const GLOBAL_TARGETS: AgentSettingsTarget["kind"][] = ["global"];
const READING_TARGETS: AgentSettingsTarget["kind"][] = [
  "global",
  "all-books",
  "book",
];

function option(
  value: AgentSettingValue,
  label = String(value),
): AgentSettingOption {
  return { value, label };
}

function enumOptions(values: readonly string[]): AgentSettingOption[] {
  return values.map((value) => option(value));
}

function appThemeOptions(draft: SettingsDraft): AgentSettingOption[] {
  return [
    { value: "system", label: "System", source: "builtin" },
    { value: "light", label: "Light", source: "builtin", polarity: "light" },
    { value: "dark", label: "Dark", source: "builtin", polarity: "dark" },
    ...draft.pluginThemes
      .filter((theme) => theme.app)
      .map((theme) => ({
        value: toPluginRef(theme.pluginId, theme.id),
        label: contributionText(theme.name),
        source: "plugin" as const,
        pluginName: theme.pluginName,
        polarity: theme.polarity,
      })),
  ];
}

function readerThemeOptions(draft: SettingsDraft): AgentSettingOption[] {
  return [
    { value: "auto", label: "Automatic", source: "builtin" },
    { value: "light", label: "Light", source: "builtin", polarity: "light" },
    { value: "warm", label: "Warm", source: "builtin", polarity: "light" },
    { value: "dark", label: "Dark", source: "builtin", polarity: "dark" },
    ...draft.pluginThemes
      .filter((theme) => theme.reader)
      .map((theme) => ({
        value: toPluginRef(theme.pluginId, theme.id),
        label: contributionText(theme.name),
        source: "plugin" as const,
        pluginName: theme.pluginName,
        polarity: theme.polarity,
      })),
  ];
}

function fontOptions(draft: SettingsDraft): AgentSettingOption[] {
  return [
    ...CURATED_FONTS.map((font) => option(`curated:${font.id}`, font.label)),
    ...draft.pluginFonts.map((font) => ({
      value: toPluginRef(font.pluginId, font.id),
      label: font.family,
      source: "plugin" as const,
      pluginName: font.pluginName,
    })),
  ];
}

function enumValue(
  definition: SettingDefinition,
  value: AgentSettingValue,
  draft: SettingsDraft,
): AgentSettingValue {
  const options =
    typeof definition.options === "function"
      ? definition.options(draft)
      : (definition.options ?? []);
  if (!options.some((candidate) => Object.is(candidate.value, value))) {
    throw new Error(
      `${definition.path} must be one of: ${options.map((candidate) => String(candidate.value)).join(", ")}`,
    );
  }
  return value;
}

export function validateSettingValue(
  definition: SettingDefinition,
  value: AgentSettingValue,
  draft: SettingsDraft,
): AgentSettingValue {
  if (value === null) {
    if (definition.nullable) return value;
    throw new Error(`${definition.path} cannot be null`);
  }
  if (definition.validate) return definition.validate(value, draft);
  if (definition.kind === "enum") return enumValue(definition, value, draft);
  if (definition.kind === "boolean" && typeof value !== "boolean") {
    throw new Error(`${definition.path} must be a boolean`);
  }
  if (definition.kind === "string" && typeof value !== "string") {
    throw new Error(`${definition.path} must be a string`);
  }
  if (
    definition.kind === "integer" &&
    (typeof value !== "number" || !Number.isInteger(value))
  ) {
    throw new Error(`${definition.path} must be an integer`);
  }
  return value;
}

function cleanModel(value: AgentSettingValue, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function cleanFontFamily(
  value: AgentSettingValue,
  draft: SettingsDraft,
): ReaderFontFamily {
  if (typeof value !== "string") {
    throw new Error("reading.fontFamily must be a string");
  }
  const font = value.trim();
  if (
    font.startsWith("curated:") &&
    getCuratedFont(font.slice("curated:".length))
  ) {
    return font as `curated:${string}`;
  }
  if (font.startsWith("plugin:")) {
    const registered = findRegisteredByRef(font, draft.pluginFonts);
    if (registered) return font as `plugin:${string}`;
    throw new Error(`unknown plugin font: ${font}`);
  }
  if (font.startsWith("system:")) {
    const family = font.slice("system:".length).trim();
    if (
      family &&
      family.length <= 120 &&
      !/[\u0000-\u001f\u007f]/.test(family)
    ) {
      return `system:${family}`;
    }
  }
  throw new Error(
    "reading.fontFamily must be a catalog option or a non-empty system:<family> value",
  );
}

function readingPrefs(
  draft: SettingsDraft,
  target: AgentSettingsQueryTarget,
): ReaderSettingsPreferences {
  if (target.kind !== "book") return draft.reading;
  const override = draft.readerOverrides[target.bookId];
  return override?.scope === "book" ? override.settings : draft.reading;
}

function writeReading(
  draft: SettingsDraft,
  target: AgentSettingsTarget,
  update: (current: ReaderSettingsPreferences) => ReaderSettingsPreferences,
): void {
  if (target.kind === "global") {
    draft.reading = update(draft.reading);
    return;
  }
  if (target.kind === "all-books") {
    draft.reading = update(draft.reading);
    for (const [bookId, override] of Object.entries(draft.readerOverrides)) {
      draft.readerOverrides[bookId] = {
        ...override,
        settings: update(override.settings),
      };
    }
    return;
  }
  const bookId = target.bookId.trim();
  if (!bookId) throw new Error("book target requires bookId");
  const existing = draft.readerOverrides[bookId];
  const base = existing?.scope === "book" ? existing.settings : draft.reading;
  draft.readerOverrides[bookId] = { scope: "book", settings: update(base) };
}

function assertThinkingLevel(value: AgentSettingValue): ThinkingLevel {
  const levels: ThinkingLevel[] = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ];
  if (typeof value !== "string" || !levels.includes(value as ThinkingLevel)) {
    throw new Error(`unsupported thinking level: ${String(value)}`);
  }
  return value as ThinkingLevel;
}

type AIConnectionPatch = Partial<{
  primaryModel: string;
  fastModel: string | null;
  thinkingLevel: ThinkingLevel;
  fastThinkingLevel: ThinkingLevel;
  customApi: CustomOpenAIApi;
  customSupportsThinking: boolean;
  customMaxOutputTokens: number | null;
}>;

function nextAIConfig(
  config: AIConfig | null,
  patch: AIConnectionPatch,
): AIConfig {
  if (!config)
    throw new Error("AI connection settings have not been configured yet");

  const primaryModel = patch.primaryModel ?? config.model;
  const hadSeparateFastModel = Boolean(
    config.fastModel && config.fastModel !== config.model,
  );
  let fastModel: string | undefined;
  if (patch.fastModel === null) {
    fastModel = undefined;
  } else if (patch.fastModel !== undefined) {
    fastModel = patch.fastModel === primaryModel ? undefined : patch.fastModel;
  } else {
    fastModel = hadSeparateFastModel ? config.fastModel : undefined;
    if (fastModel === primaryModel) fastModel = undefined;
  }

  if (patch.fastThinkingLevel !== undefined && !fastModel) {
    throw new Error(
      "ai.connection.fastThinkingLevel requires a separate Fast model",
    );
  }
  const customPatchRequested =
    patch.customApi !== undefined ||
    patch.customSupportsThinking !== undefined ||
    patch.customMaxOutputTokens !== undefined;
  if (customPatchRequested && config.provider !== "custom") {
    throw new Error(
      "Custom compatibility settings require the active Custom provider",
    );
  }

  const thinkingLevel =
    patch.thinkingLevel ?? config.thinkingLevel ?? DEFAULT_THINKING_LEVEL;
  return {
    ...config,
    model: primaryModel,
    fastModel,
    thinkingLevel,
    fastThinkingLevel: fastModel
      ? (patch.fastThinkingLevel ?? config.fastThinkingLevel ?? thinkingLevel)
      : thinkingLevel,
    ...(config.provider === "custom"
      ? {
          customApi: patch.customApi ?? config.customApi,
          customSupportsThinking:
            patch.customSupportsThinking ?? config.customSupportsThinking,
          customMaxOutputTokens:
            patch.customMaxOutputTokens === null
              ? undefined
              : (patch.customMaxOutputTokens ?? config.customMaxOutputTokens),
        }
      : {}),
  };
}

function globalDefinition(
  definition: Omit<SettingDefinition, "supportedTargets">,
): SettingDefinition {
  return {
    ...definition,
    supportedTargets: definition.write ? GLOBAL_TARGETS : undefined,
  };
}

function readingDefinition(
  definition: Omit<SettingDefinition, "section" | "supportedTargets">,
): SettingDefinition {
  return {
    ...definition,
    section: "reading",
    supportedTargets: READING_TARGETS,
  };
}

export function buildSettingDefinitions(
  draft: SettingsDraft,
): SettingDefinition[] {
  const definitions: SettingDefinition[] = [
    globalDefinition({
      path: "general.startView",
      section: "general",
      label: "Start view",
      kind: "enum",
      options: [option("shelf", "Shelf"), option("resume", "Resume reading")],
      read: (state) => state.general.startView,
      write: (state, value) => {
        state.general.startView = value as GeneralSettings["startView"];
      },
    }),
    globalDefinition({
      path: "general.language",
      section: "general",
      label: "Language",
      kind: "enum",
      options: LOCALES.map((locale) => option(locale, LOCALE_LABELS[locale])),
      read: (state) => state.general.language ?? detectInitialLocale(null),
      write: (state, value) => {
        state.general.language = value as GeneralSettings["language"];
      },
    }),
    ...(
      [
        ["general.crashReports", "Crash reports", "crashReports"],
        ["general.launchAtStartup", "Launch at startup", "launchAtStartup"],
        ["general.fileAssociations", "File associations", "fileAssociations"],
        ["general.autoUpdate", "Automatic updates", "autoUpdate"],
      ] as const
    ).map(([path, label, key]) =>
      globalDefinition({
        path,
        section: "general",
        label,
        kind: "boolean",
        read: (state) => state.general[key],
        write: (state, value) => {
          state.general[key] = value as boolean;
        },
      }),
    ),
    globalDefinition({
      path: "appearance.theme",
      section: "appearance",
      label: "App theme",
      kind: "enum",
      options: appThemeOptions,
      read: (state) => state.appearance.theme,
      write: (state, value) => {
        state.appearance.theme = value as AppThemePreference;
      },
    }),
    globalDefinition({
      path: "appearance.motion",
      section: "appearance",
      label: "Motion",
      kind: "enum",
      options: [
        option("system", "Follow system"),
        option("reduced", "Reduced"),
      ],
      read: (state) => state.appearance.motion,
      write: (state, value) => {
        state.appearance.motion = value as AppSettings["motion"];
      },
    }),
    readingDefinition({
      path: "reading.theme",
      label: "Page theme",
      kind: "enum",
      options: readerThemeOptions,
      read: (state, target) => readingPrefs(state, target).theme,
      write: (state, value, target) => {
        writeReading(state, target, (current) =>
          applyReaderThemeSelection(
            current,
            value as ReaderThemePreference,
            state.pluginThemes,
          ),
        );
      },
    }),
    readingDefinition({
      path: "reading.fontFamily",
      label: "Font family",
      description: "Use a catalog option, or a system font as system:<family>.",
      kind: "string",
      options: fontOptions,
      read: (state, target) => readingPrefs(state, target).fontFamily,
      validate: (value, state) => cleanFontFamily(value, state),
      write: (state, value, target) => {
        writeReading(state, target, (current) => ({
          ...current,
          fontFamily: value as ReaderFontFamily,
        }));
      },
    }),
    ...(
      [
        [
          "reading.fontSize",
          "Font size",
          "fontSize",
          [
            "xx-small",
            "x-small",
            "small",
            "medium",
            "large",
            "x-large",
            "xx-large",
            "xxx-large",
          ],
        ],
        [
          "reading.fontWeight",
          "Font weight",
          "fontWeight",
          ["light", "regular", "medium", "bold"],
        ],
        [
          "reading.lineSpacing",
          "Line spacing",
          "lineSpacing",
          ["compact", "comfortable", "relaxed"],
        ],
        [
          "reading.paragraphSpacing",
          "Paragraph spacing",
          "paragraphSpacing",
          ["tight", "normal", "loose"],
        ],
        [
          "reading.pageMargins",
          "Page margins",
          "pageMargins",
          ["narrow", "medium", "wide"],
        ],
        [
          "reading.readingMode",
          "Reading mode",
          "readingMode",
          ["scroll", "paginated-single", "paginated-double"],
        ],
      ] as const
    ).map(([path, label, key, values]) =>
      readingDefinition({
        path,
        label,
        kind: "enum",
        options: enumOptions(values),
        read: (state, target) => readingPrefs(state, target)[key],
        write: (state, value, target) => {
          writeReading(state, target, (current) => ({
            ...current,
            [key]: value,
          }));
        },
      }),
    ),
    ...AI_FEATURE_KEYS.map((key) =>
      globalDefinition({
        path: `ai.preferences.features.${key}`,
        section: "ai",
        label: key,
        kind: "boolean",
        read: (state) => state.aiPreferences.features[key],
        write: (state, value) => {
          state.aiPreferences.features[key] = value as boolean;
        },
      }),
    ),
    ...(
      [
        ["ai.preferences.buildMemory", "Build memory", "buildMemory"],
        [
          "ai.preferences.sendHighlightedText",
          "Send highlighted text",
          "sendHighlightedText",
        ],
        [
          "ai.preferences.sendSurroundingContext",
          "Send surrounding context",
          "sendSurroundingContext",
        ],
        ["ai.preferences.localOnly", "Local only", "localOnly"],
        [
          "ai.preferences.followStreaming",
          "Follow streaming",
          "followStreaming",
        ],
      ] as const
    ).map(([path, label, key]) =>
      globalDefinition({
        path,
        section: "ai",
        label,
        kind: "boolean",
        read: (state) => state.aiPreferences[key],
        write: (state, value) => {
          state.aiPreferences[key] = value as boolean;
        },
      }),
    ),
    globalDefinition({
      path: "ai.connection.configured",
      section: "ai",
      label: "Connection configured",
      kind: "boolean",
      read: (state) => Boolean(state.aiConfig),
    }),
    globalDefinition({
      path: "ai.connection.credentialConfigured",
      section: "ai",
      label: "Credential configured",
      kind: "boolean",
      read: (state) => Boolean(state.aiConfig?.apiKey),
    }),
  ];

  if (!draft.aiConfig) return definitions;

  const thinkingOptions = enumOptions([
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  const separateFastModel = Boolean(
    draft.aiConfig.fastModel &&
    draft.aiConfig.fastModel !== draft.aiConfig.model,
  );
  definitions.push(
    globalDefinition({
      path: "ai.connection.provider",
      section: "ai",
      label: "Provider",
      kind: "string",
      read: (state) => state.aiConfig?.provider ?? "",
    }),
    globalDefinition({
      path: "ai.connection.primaryModel",
      section: "ai",
      label: "Primary model",
      kind: "string",
      read: (state) => state.aiConfig?.model ?? "",
      validate: (value) => cleanModel(value, "ai.connection.primaryModel"),
      write: (state, value) => {
        state.aiConfig = nextAIConfig(state.aiConfig, {
          primaryModel: value as string,
        });
      },
    }),
    globalDefinition({
      path: "ai.connection.fastModel",
      section: "ai",
      label: "Fast model override",
      description: "Null makes Fast follow the Primary model.",
      kind: "string",
      nullable: true,
      read: (state) => {
        const config = state.aiConfig;
        if (!config) return null;
        return config.fastModel && config.fastModel !== config.model
          ? config.fastModel
          : null;
      },
      validate: (value) =>
        value === null ? null : cleanModel(value, "ai.connection.fastModel"),
      write: (state, value) => {
        state.aiConfig = nextAIConfig(state.aiConfig, {
          fastModel: value as string | null,
        });
      },
    }),
    globalDefinition({
      path: "ai.connection.thinkingLevel",
      section: "ai",
      label: "Thinking effort",
      kind: "enum",
      options: thinkingOptions,
      read: (state) => state.aiConfig?.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
      validate: assertThinkingLevel,
      write: (state, value) => {
        state.aiConfig = nextAIConfig(state.aiConfig, {
          thinkingLevel: value as ThinkingLevel,
        });
      },
    }),
  );

  if (separateFastModel) {
    definitions.push(
      globalDefinition({
        path: "ai.connection.fastThinkingLevel",
        section: "ai",
        label: "Fast thinking effort",
        kind: "enum",
        options: thinkingOptions,
        read: (state) =>
          state.aiConfig?.fastThinkingLevel ?? DEFAULT_THINKING_LEVEL,
        validate: assertThinkingLevel,
        write: (state, value) => {
          state.aiConfig = nextAIConfig(state.aiConfig, {
            fastThinkingLevel: value as ThinkingLevel,
          });
        },
      }),
    );
  }

  if (draft.aiConfig.provider === "custom") {
    definitions.push(
      globalDefinition({
        path: "ai.connection.custom.endpointConfigured",
        section: "ai",
        label: "Custom endpoint configured",
        kind: "boolean",
        read: (state) => Boolean(state.aiConfig?.customBaseUrl),
      }),
      globalDefinition({
        path: "ai.connection.custom.api",
        section: "ai",
        label: "Custom API format",
        kind: "enum",
        options: [
          option("openai-completions", "Chat Completions"),
          option("openai-responses", "Responses"),
        ],
        read: (state) => state.aiConfig?.customApi ?? "openai-completions",
        write: (state, value) => {
          state.aiConfig = nextAIConfig(state.aiConfig, {
            customApi: value as CustomOpenAIApi,
          });
        },
      }),
      globalDefinition({
        path: "ai.connection.custom.supportsThinking",
        section: "ai",
        label: "Custom provider supports thinking",
        kind: "boolean",
        read: (state) => Boolean(state.aiConfig?.customSupportsThinking),
        write: (state, value) => {
          state.aiConfig = nextAIConfig(state.aiConfig, {
            customSupportsThinking: value as boolean,
          });
        },
      }),
      globalDefinition({
        path: "ai.connection.custom.maxOutputTokens",
        section: "ai",
        label: "Custom max output tokens",
        description: "Null lets the upstream choose its own limit.",
        kind: "integer",
        nullable: true,
        read: (state) => state.aiConfig?.customMaxOutputTokens ?? null,
        validate: (value) => {
          if (value === null) return null;
          if (
            typeof value !== "number" ||
            !Number.isInteger(value) ||
            value <= 0
          ) {
            throw new Error(
              "ai.connection.custom.maxOutputTokens must be a positive integer or null",
            );
          }
          return value;
        },
        write: (state, value) => {
          state.aiConfig = nextAIConfig(state.aiConfig, {
            customMaxOutputTokens: value as number | null,
          });
        },
      }),
    );
  }

  return definitions;
}
