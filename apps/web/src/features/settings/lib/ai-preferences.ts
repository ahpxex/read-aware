import { localKV } from "../../../platform/local-store";

const STORAGE_KEY = "read-aware-ai-preferences";

/** Reader-surfaced AI capabilities. Toggles gate features as they ship. */
export type AIFeatureKey =
  | "explainSelection"
  | "defineTerm"
  | "translate"
  | "summarizeChapter"
  | "askConversation";

export const AI_FEATURE_META: { key: AIFeatureKey; label: string; description: string }[] = [
  {
    key: "explainSelection",
    label: "Explain selection",
    description: "Unpack a highlighted passage in plain language.",
  },
  {
    key: "defineTerm",
    label: "Define term",
    description: "Inline definitions for a selected word or phrase.",
  },
  {
    key: "translate",
    label: "Translate",
    description: "Translate a selection into your reading language.",
  },
  {
    key: "summarizeChapter",
    label: "Summarize chapter",
    description: "Condense the current chapter into key points.",
  },
  {
    key: "askConversation",
    label: "Conversational Q&A",
    description: "Ask follow-up questions grounded in the book and your notes.",
  },
];

export type AIPreferences = {
  features: Record<AIFeatureKey, boolean>;
  buildMemory: boolean;
  sendHighlightedText: boolean;
  sendSurroundingContext: boolean;
  localOnly: boolean;
};

export const DEFAULT_AI_PREFERENCES: AIPreferences = {
  features: {
    explainSelection: true,
    defineTerm: true,
    translate: true,
    summarizeChapter: true,
    askConversation: true,
  },
  buildMemory: true,
  sendHighlightedText: true,
  sendSurroundingContext: true,
  localOnly: false,
};

export function getAIPreferences(): AIPreferences {
  try {
    const raw = localKV.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AI_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<AIPreferences>;
    return {
      features: { ...DEFAULT_AI_PREFERENCES.features, ...(parsed.features ?? {}) },
      buildMemory: parsed.buildMemory ?? DEFAULT_AI_PREFERENCES.buildMemory,
      sendHighlightedText: parsed.sendHighlightedText ?? DEFAULT_AI_PREFERENCES.sendHighlightedText,
      sendSurroundingContext:
        parsed.sendSurroundingContext ?? DEFAULT_AI_PREFERENCES.sendSurroundingContext,
      localOnly: parsed.localOnly ?? DEFAULT_AI_PREFERENCES.localOnly,
    };
  } catch {
    return DEFAULT_AI_PREFERENCES;
  }
}

export function saveAIPreferences(prefs: AIPreferences): void {
  localKV.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
