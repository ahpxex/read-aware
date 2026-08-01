import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { CustomOpenAIApi } from "./models/custom-openai";

export type AgentSettingsLocale =
  | "en"
  | "zh-Hans"
  | "zh-Hant"
  | "ja"
  | "fr"
  | "de"
  | "ru"
  | "es";

export type AgentSettingsSection = "general" | "appearance" | "reading" | "ai";

export type AgentAIFeatureKey =
  | "explainSelection"
  | "defineTerm"
  | "translate"
  | "summarizeChapter"
  | "askConversation";

export interface AgentThemeOption {
  /** Stable value accepted by update_settings. */
  value: string;
  /** User-facing name in the active app language. */
  label: string;
  source: "builtin" | "plugin";
  pluginName?: string;
  polarity?: "light" | "dark";
}

export type AgentAppTheme = "system" | "light" | "dark" | `plugin:${string}`;
export type AgentReaderTheme =
  | "auto"
  | "light"
  | "warm"
  | "dark"
  | `plugin:${string}`;

export interface AgentSettingsSnapshot {
  general: {
    startView: "shelf" | "resume";
    language: AgentSettingsLocale;
    crashReports: boolean;
    launchAtStartup: boolean;
    fileAssociations: boolean;
    autoUpdate: boolean;
  };
  appearance: {
    theme: AgentAppTheme;
    motion: "system" | "reduced";
    /** Current valid choices, including enabled plugin contributions. */
    availableThemes: AgentThemeOption[];
  };
  reading: {
    theme: AgentReaderTheme;
    /** Current valid page themes, including enabled plugin contributions. */
    availableThemes: AgentThemeOption[];
    fontFamily: string;
    fontSize:
      | "xx-small"
      | "x-small"
      | "small"
      | "medium"
      | "large"
      | "x-large"
      | "xx-large"
      | "xxx-large";
    fontWeight: "light" | "regular" | "medium" | "bold";
    lineSpacing: "compact" | "comfortable" | "relaxed";
    paragraphSpacing: "tight" | "normal" | "loose";
    pageMargins: "narrow" | "medium" | "wide";
    readingMode: "scroll" | "paginated-single" | "paginated-double";
  };
  ai: {
    preferences: {
      features: Record<AgentAIFeatureKey, boolean>;
      buildMemory: boolean;
      sendHighlightedText: boolean;
      sendSurroundingContext: boolean;
      localOnly: boolean;
      followStreaming: boolean;
    };
    /** Deliberately sanitized: credentials and endpoint values never cross this port. */
    connection: {
      configured: boolean;
      credentialConfigured: boolean;
      provider?: string;
      primaryModel?: string;
      fastModel?: string;
      separateFastModel?: boolean;
      thinkingLevel?: ThinkingLevel;
      fastThinkingLevel?: ThinkingLevel;
      custom?: {
        endpointConfigured: boolean;
        api: CustomOpenAIApi;
        supportsThinking: boolean;
        maxOutputTokens?: number;
      };
    };
  };
}

export interface AgentSettingsPatch {
  general?: Partial<{
    startView: AgentSettingsSnapshot["general"]["startView"];
    language: AgentSettingsLocale;
    crashReports: boolean;
    launchAtStartup: boolean;
    fileAssociations: boolean;
    autoUpdate: boolean;
  }>;
  appearance?: Partial<{
    theme: AgentAppTheme;
    motion: AgentSettingsSnapshot["appearance"]["motion"];
  }>;
  reading?: Partial<{
    theme: AgentReaderTheme;
    fontFamily: string;
    fontSize: AgentSettingsSnapshot["reading"]["fontSize"];
    fontWeight: AgentSettingsSnapshot["reading"]["fontWeight"];
    lineSpacing: AgentSettingsSnapshot["reading"]["lineSpacing"];
    paragraphSpacing: AgentSettingsSnapshot["reading"]["paragraphSpacing"];
    pageMargins: AgentSettingsSnapshot["reading"]["pageMargins"];
    readingMode: AgentSettingsSnapshot["reading"]["readingMode"];
  }>;
  ai?: {
    preferences?: Partial<{
      features: Partial<Record<AgentAIFeatureKey, boolean>>;
      buildMemory: boolean;
      sendHighlightedText: boolean;
      sendSurroundingContext: boolean;
      localOnly: boolean;
      followStreaming: boolean;
    }>;
    connection?: Partial<{
      primaryModel: string;
      /** Null removes the separate Fast override so it follows Primary again. */
      fastModel: string | null;
      thinkingLevel: ThinkingLevel;
      fastThinkingLevel: ThinkingLevel;
      customApi: CustomOpenAIApi;
      customSupportsThinking: boolean;
      /** Null lets the Custom upstream choose its own output limit. */
      customMaxOutputTokens: number | null;
    }>;
  };
}

export interface AgentSettingsUpdateResult {
  changed: string[];
  settings: AgentSettingsSnapshot;
}
