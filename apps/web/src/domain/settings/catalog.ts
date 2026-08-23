import type {
  SettingDescriptor,
  SettingOption,
  SettingValue,
  SettingsQueryTarget,
  SettingsSection,
  SettingsTarget,
} from "@read-aware/core";
import type { CustomOpenAIApi, ThinkingLevel } from "@read-aware/agent";
import { LOCALES, LOCALE_LABELS } from "../../i18n/config";
import { detectInitialLocale } from "../../i18n/detect";
import type {
  AppSettings,
  AppThemePreference,
} from "../../features/settings/lib/app-settings";
import type { AIPreferences } from "../../features/settings/lib/ai-preferences";
import { AI_FEATURE_KEYS } from "../../features/settings/lib/ai-preferences";
import {
  CURATED_FONTS,
  getCuratedFont,
} from "../../features/settings/lib/curated-font-catalog";
import type { GeneralSettings } from "../../features/settings/lib/general-settings";
import type { ReaderOverrides } from "../../features/settings/lib/reader-overrides";
import type {
  ReaderFontFamily,
  ReaderSettingsPreferences,
  ReaderThemePreference,
} from "../../features/settings/lib/reader-settings";
import { applyReaderThemeSelection } from "../../features/settings/lib/reader-theme";
import { builtinThemesFor } from "../../features/settings/lib/appearance-control";
import { contributionText } from "../../features/plugins/lib/plugin-i18n";
import { isTimeOfDay } from "../../features/plugins/lib/time-of-day";
import {
  findRegisteredByRef,
  toPluginRef,
} from "../../features/plugins/lib/plugin-theme";
import type {
  RegisteredPluginFont,
  RegisteredPluginTheme,
} from "../../features/plugins/lib/plugin-types";
import {
  DEFAULT_THINKING_LEVEL,
  type AIConfig,
} from "../../features/ai/lib/ai-config";
import {
  knownSurfaceItems,
  resolvedSurfaceLayout,
  type MenuPluginState,
} from "../../features/menus/lib/agent-menu-items";
import {
  SURFACE_RULES,
  type MenuConfig,
  type MenuSurface,
} from "../../features/menus/state/menu-config";
import type { AgentPluginSettings } from "../../features/plugins/lib/plugin-settings";
import type {
  PluginFormField,
  PluginFormValues,
} from "../../features/plugins/lib/plugin-types";

export type SettingsDraft = {
  general: GeneralSettings;
  appearance: AppSettings;
  reading: ReaderSettingsPreferences;
  readerOverrides: ReaderOverrides;
  aiPreferences: AIPreferences;
  aiConfig: AIConfig | null;
  pluginThemes: RegisteredPluginTheme[];
  pluginFonts: RegisteredPluginFont[];
  menus: {
    /** Mutable: the user-arranged layouts (menuConfigAtom). */
    config: MenuConfig;
    /** Environment: plugin contributions that define the known items. */
    plugins: MenuPluginState;
  };
  pluginSettings: {
    /** Environment: agent-visible declared fields of enabled plugins. */
    declared: AgentPluginSettings[];
    /** Mutable: stored value objects, keyed by plugin id. */
    values: Record<string, PluginFormValues>;
  };
};

export type SettingDefinition = {
  path: string;
  section: SettingsSection;
  label: string;
  description?: string;
  kind: SettingDescriptor["kind"];
  nullable?: boolean;
  options?:
    SettingOption[] | ((draft: SettingsDraft) => SettingOption[]);
  supportedTargets?: SettingsTarget["kind"][];
  read: (
    draft: SettingsDraft,
    target: SettingsQueryTarget,
  ) => SettingValue;
  write?: (
    draft: SettingsDraft,
    value: SettingValue,
    target: SettingsTarget,
  ) => void;
  validate?: (
    value: SettingValue,
    draft: SettingsDraft,
  ) => SettingValue;
};

const GLOBAL_TARGETS: SettingsTarget["kind"][] = ["global"];
const READING_TARGETS: SettingsTarget["kind"][] = [
  "global",
  "all-books",
  "book",
];

function option(
  value: SettingValue,
  label = String(value),
): SettingOption {
  return { value, label };
}

function enumOptions(values: readonly string[]): SettingOption[] {
  return values.map((value) => option(value));
}

/**
 * The agent names theme values in English regardless of the UI language —
 * its settings snapshot is model-facing, not user-facing. The VALUES come
 * from the shared appearance vocabulary (`appearance-control`), so UI, Agent,
 * and path-scoped plugin access can never offer different sets.
 */
const BUILTIN_THEME_LABELS: Record<string, string> = {
  system: "System",
  auto: "Automatic",
  light: "Light",
  warm: "Warm",
  dark: "Dark",
};

function themeOptions(
  draft: SettingsDraft,
  surface: "app" | "reader",
): SettingOption[] {
  return [
    ...builtinThemesFor(surface).map((builtin) => ({
      value: builtin.value,
      label: BUILTIN_THEME_LABELS[builtin.value] ?? builtin.value,
      source: "builtin" as const,
      ...(builtin.polarity ? { polarity: builtin.polarity } : {}),
    })),
    ...draft.pluginThemes
      .filter((theme) => (surface === "app" ? theme.app : theme.reader))
      .map((theme) => ({
        value: toPluginRef(theme.pluginId, theme.id),
        label: contributionText(theme.name),
        source: "plugin" as const,
        pluginName: theme.pluginName,
        polarity: theme.polarity,
      })),
  ];
}

function appThemeOptions(draft: SettingsDraft): SettingOption[] {
  return themeOptions(draft, "app");
}

function readerThemeOptions(draft: SettingsDraft): SettingOption[] {
  return themeOptions(draft, "reader");
}

function fontOptions(draft: SettingsDraft): SettingOption[] {
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
  value: SettingValue,
  draft: SettingsDraft,
): SettingValue {
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
  value: SettingValue,
  draft: SettingsDraft,
): SettingValue {
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
  if (
    definition.kind === "number" &&
    (typeof value !== "number" || !Number.isFinite(value))
  ) {
    throw new Error(`${definition.path} must be a number`);
  }
  return value;
}

function cleanModel(value: SettingValue, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function cleanFontFamily(
  value: SettingValue,
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
  target: SettingsQueryTarget,
): ReaderSettingsPreferences {
  if (target.kind !== "book") return draft.reading;
  const override = draft.readerOverrides[target.bookId];
  return override?.scope === "book" ? override.settings : draft.reading;
}

function writeReading(
  draft: SettingsDraft,
  target: SettingsTarget,
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

function assertThinkingLevel(value: SettingValue): ThinkingLevel {
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

const MENU_SURFACES: Array<{
  surface: MenuSurface;
  label: string;
  description?: string;
}> = [
  {
    surface: "primaryNav",
    label: "Primary navigation",
    description:
      "The centered destination switcher; 1–4 visible destinations, in order",
  },
  { surface: "shelfHeader", label: "Shelf header" },
  { surface: "readerHeader", label: "Reader header" },
  { surface: "selection", label: "Selection menu" },
];

function menuListValue(path: string, value: SettingValue): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`${path} must be an array of item ids`);
  }
  if (new Set(value).size !== value.length) {
    throw new Error(`${path} must not repeat ids`);
  }
  return value;
}

function menuListDefinition(
  surface: MenuSurface,
  zone: "visible" | "overflow",
  surfaceLabel: string,
  description?: string,
): SettingDefinition {
  const path = `menus.${surface}.${zone}`;
  return {
    path,
    section: "menus",
    label:
      zone === "visible"
        ? `${surfaceLabel} — shown`
        : `${surfaceLabel} — overflow menu`,
    ...(description ? { description } : {}),
    kind: "id-list",
    options: (draft) =>
      knownSurfaceItems(surface, draft.menus.plugins).map((item) => ({
        value: item.id,
        label: item.label,
        source: item.source,
        ...(item.pluginName ? { pluginName: item.pluginName } : {}),
      })),
    supportedTargets: GLOBAL_TARGETS,
    read: (draft) =>
      resolvedSurfaceLayout(surface, draft.menus.config, draft.menus.plugins)[
        zone
      ],
    validate: (value, draft) => {
      const ids = menuListValue(path, value);
      const known = new Set(
        knownSurfaceItems(surface, draft.menus.plugins).map((item) => item.id),
      );
      const unknown = ids.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw new Error(
          `${path}: unknown ids ${unknown.join(", ")} — use ids from this path's options`,
        );
      }
      const rules = SURFACE_RULES[surface];
      if (zone === "visible") {
        if (ids.length < rules.minVisible) {
          throw new Error(
            `${path} needs at least ${rules.minVisible} item(s)`,
          );
        }
        if (rules.maxVisible !== null && ids.length > rules.maxVisible) {
          throw new Error(
            `${path} allows at most ${rules.maxVisible} items`,
          );
        }
      }
      return ids;
    },
    write: (draft, value) => {
      const ids = value as string[];
      const sibling = zone === "visible" ? "overflow" : "visible";
      // Work from the RESOLVED layout (what read reported), so items the
      // stored config never placed still move coherently.
      const current = resolvedSurfaceLayout(
        surface,
        draft.menus.config,
        draft.menus.plugins,
      );
      // "This zone contains exactly these": anything evicted moves to the
      // other zone (hide = drop from visible → lands in overflow), anything
      // adopted leaves it.
      const evicted = current[zone].filter((id) => !ids.includes(id));
      const siblingIds = [
        ...current[sibling].filter((id) => !ids.includes(id)),
        ...evicted.filter((id) => !current[sibling].includes(id)),
      ];
      // The move can reshape BOTH zones — re-check the surface invariants on
      // the resulting visible list, whichever zone was written.
      const nextVisible = zone === "visible" ? ids : siblingIds;
      const rules = SURFACE_RULES[surface];
      if (nextVisible.length < rules.minVisible) {
        throw new Error(
          `${path} would leave fewer than ${rules.minVisible} visible item(s)`,
        );
      }
      if (rules.maxVisible !== null && nextVisible.length > rules.maxVisible) {
        throw new Error(
          `${path} would exceed ${rules.maxVisible} visible items`,
        );
      }
      draft.menus.config = {
        ...draft.menus.config,
        [surface]:
          zone === "visible"
            ? { visible: ids, overflow: siblingIds }
            : { visible: siblingIds, overflow: ids },
      };
    },
  };
}

/** Path segments must fit the settings tool's dotted-path grammar. */
const PATH_SEGMENT_RE = /^[a-z][a-zA-Z0-9-]*$/;

function pluginFieldDefinition(
  plugin: AgentPluginSettings,
  field: PluginFormField,
): SettingDefinition | null {
  // Credentials never enter the agent's settings surface.
  if (field.kind === "secret") return null;
  if (
    !PATH_SEGMENT_RE.test(plugin.pluginId) ||
    !PATH_SEGMENT_RE.test(field.id)
  ) {
    return null;
  }
  const path = `plugins.${plugin.pluginId}.${field.id}`;
  const fieldLabel = contributionText(field.label);
  // A dynamicOptions select resolves its options at runtime inside the
  // plugin — statically it is a free string, not an enumerable set.
  const dynamicSelect = field.kind === "select" && field.dynamicOptions === true;
  const kind =
    field.kind === "toggle" || field.kind === "checkbox"
      ? ("boolean" as const)
      : (field.kind === "select" && !dynamicSelect) || field.kind === "choice"
        ? ("enum" as const)
        : field.kind === "number"
          ? ("number" as const)
          : ("string" as const);
  const hasDefault = field.value !== undefined;
  return {
    path,
    section: "plugins",
    label: `${plugin.pluginName} — ${fieldLabel}`,
    ...("helperText" in field && field.helperText
      ? { description: contributionText(field.helperText) }
      : field.kind === "time"
        ? { description: "A time of day as HH:MM (24-hour)." }
        : {}),
    kind,
    ...(hasDefault ? {} : { nullable: true }),
    ...(kind === "enum" && "options" in field
      ? {
          options: field.options.map((choice) => ({
            value: choice.value,
            label: contributionText(choice.label),
            source: "plugin" as const,
            pluginName: plugin.pluginName,
          })),
        }
      : {}),
    supportedTargets: GLOBAL_TARGETS,
    read: (draft) =>
      draft.pluginSettings.values[plugin.pluginId]?.[field.id] ??
      field.value ??
      null,
    validate: (value) => {
      if (value === null) return value;
      if (kind === "boolean" && typeof value !== "boolean") {
        throw new Error(`${path} must be a boolean`);
      }
      if (kind === "string" && typeof value !== "string") {
        throw new Error(`${path} must be a string`);
      }
      if (field.kind === "time" && !isTimeOfDay(value)) {
        throw new Error(`${path} must be a time of day as HH:MM (24-hour)`);
      }
      if (kind === "enum") {
        const choices =
          "options" in field ? field.options.map((choice) => choice.value) : [];
        if (typeof value !== "string" || !choices.includes(value)) {
          throw new Error(`${path} must be one of: ${choices.join(", ")}`);
        }
      }
      if (kind === "number") {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new Error(`${path} must be a number`);
        }
        if (field.kind === "number") {
          if (field.min !== undefined && value < field.min) {
            throw new Error(`${path} must be at least ${field.min}`);
          }
          if (field.max !== undefined && value > field.max) {
            throw new Error(`${path} must be at most ${field.max}`);
          }
        }
      }
      return value;
    },
    write: (draft, value) => {
      const current = {
        ...(draft.pluginSettings.values[plugin.pluginId] ?? {}),
      };
      // null resets an optional field back to unset (the declared default).
      if (value === null) delete current[field.id];
      else current[field.id] = value as string | number | boolean;
      draft.pluginSettings.values = {
        ...draft.pluginSettings.values,
        [plugin.pluginId]: current,
      };
    },
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

  for (const { surface, label, description } of MENU_SURFACES) {
    definitions.push(
      menuListDefinition(surface, "visible", label, description),
      menuListDefinition(surface, "overflow", label),
    );
  }

  for (const plugin of draft.pluginSettings.declared) {
    for (const field of plugin.fields) {
      const definition = pluginFieldDefinition(plugin, field);
      if (definition) definitions.push(definition);
    }
  }

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
