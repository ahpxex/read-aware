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

const STORAGE_KEY = "read-aware-ai-config";

export function getAIConfig(): AIConfig | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as AIConfig;
  } catch {
    return null;
  }
}

export function saveAIConfig(config: AIConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearAIConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
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
