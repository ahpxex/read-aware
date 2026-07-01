/**
 * AI Configuration storage and types for BYOK (Bring Your Own Key) model
 */

export type AIProvider = "openai" | "anthropic" | "openrouter" | "custom";

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
  customBaseUrl?: string;
}

import { localKV } from "../../../platform/local-store";

// Non-secret connection fields (provider/model/customBaseUrl) go through the
// device-local store (SQLite on desktop). The API key is a secret and is kept
// OUT of SQLite — it stays in localStorage until a Keychain path lands.
const CONFIG_KEY = "read-aware-ai-config";
const API_KEY_KEY = "read-aware-ai-key";

export function getAIConfig(): AIConfig | null {
  try {
    const stored = localKV.getItem(CONFIG_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<AIConfig>;
    if (!parsed.provider) return null;
    // Read the key from its dedicated localStorage slot, falling back to a
    // legacy combined blob's `apiKey` (pre-split records migrate on next save).
    const apiKey = localStorage.getItem(API_KEY_KEY) ?? parsed.apiKey ?? "";
    return {
      provider: parsed.provider,
      apiKey,
      model: parsed.model ?? "",
      customBaseUrl: parsed.customBaseUrl,
    };
  } catch {
    return null;
  }
}

export function saveAIConfig(config: AIConfig): void {
  const { apiKey, ...nonSecret } = config;
  localKV.setItem(CONFIG_KEY, JSON.stringify(nonSecret));
  if (apiKey) localStorage.setItem(API_KEY_KEY, apiKey);
  else localStorage.removeItem(API_KEY_KEY);
}

export function clearAIConfig(): void {
  localKV.removeItem(CONFIG_KEY);
  localStorage.removeItem(API_KEY_KEY);
}

export function hasAIConfig(): boolean {
  return getAIConfig() !== null;
}

// Default models for each provider
export const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  openrouter: "openai/gpt-4o-mini",
  custom: "",
};

// Model options for each provider
export const PROVIDER_MODELS: Record<AIProvider, { label: string; value: string }[]> = {
  openai: [
    { label: "GPT-4o", value: "gpt-4o" },
    { label: "GPT-4o Mini", value: "gpt-4o-mini" },
    { label: "GPT-4 Turbo", value: "gpt-4-turbo" },
  ],
  anthropic: [
    { label: "Claude 3.5 Sonnet", value: "claude-3-5-sonnet-20241022" },
    { label: "Claude 3.5 Haiku", value: "claude-3-5-haiku-20241022" },
    { label: "Claude 3 Opus", value: "claude-3-opus-20240229" },
  ],
  openrouter: [
    { label: "GPT-4o", value: "openai/gpt-4o" },
    { label: "GPT-4o Mini", value: "openai/gpt-4o-mini" },
    { label: "Claude 3.5 Sonnet", value: "anthropic/claude-3.5-sonnet" },
    { label: "Claude 3.5 Haiku", value: "anthropic/claude-3.5-haiku" },
    { label: "DeepSeek V3", value: "deepseek/deepseek-chat" },
  ],
  custom: [],
};

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  custom: "Custom (OpenAI-compatible)",
};
