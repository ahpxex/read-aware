/**
 * AI Configuration storage and types for BYOK (Bring Your Own Key) model
 */

export type AIProvider =
  | "openai"
  | "anthropic"
  | "openrouter"
  | "zai"
  | "zai-coding-cn"
  | "google"
  | "deepseek"
  | "xai"
  | "groq"
  | "mistral"
  | "moonshotai"
  | "custom";

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  /** The "smart" tier model (chat, onboarding, synthesis). */
  model: string;
  /** The "fast" tier model (dictionary, memory, summaries). Falls back to a
   *  per-provider default, or to `model` for custom endpoints. */
  fastModel?: string;
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
      fastModel: parsed.fastModel,
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

// Default "smart" model for each provider (chat, onboarding, synthesis).
export const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: "gpt-5.1",
  anthropic: "claude-opus-4-8",
  openrouter: "anthropic/claude-opus-4.7",
  zai: "glm-5.2",
  "zai-coding-cn": "glm-5.2",
  google: "gemini-2.5-pro",
  deepseek: "deepseek-v4-pro",
  xai: "grok-4.3",
  groq: "llama-3.3-70b-versatile",
  mistral: "mistral-large-latest",
  moonshotai: "kimi-k2.6",
  custom: "",
};

// Default "fast" model for each provider (dictionary, memory, summaries — the
// cheap/quick tier). `custom` resolves to the smart model (single endpoint).
export const FAST_DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: "gpt-5-mini",
  anthropic: "claude-haiku-4-5",
  openrouter: "anthropic/claude-haiku-4.5",
  zai: "glm-4.5-air",
  "zai-coding-cn": "glm-4.5-air",
  google: "gemini-2.5-flash",
  deepseek: "deepseek-v4-flash",
  xai: "grok-3-fast",
  groq: "llama-3.1-8b-instant",
  mistral: "ministral-8b-latest",
  moonshotai: "kimi-k2-turbo-preview",
  custom: "",
};

// Model options for each provider (shared by the Smart and Fast dropdowns).
export const PROVIDER_MODELS: Record<AIProvider, { label: string; value: string }[]> = {
  openai: [
    { label: "GPT-5.1", value: "gpt-5.1" },
    { label: "GPT-5", value: "gpt-5" },
    { label: "GPT-5 Mini", value: "gpt-5-mini" },
    { label: "GPT-5 Nano", value: "gpt-5-nano" },
    { label: "GPT-4.1", value: "gpt-4.1" },
    { label: "GPT-4o", value: "gpt-4o" },
    { label: "GPT-4o Mini", value: "gpt-4o-mini" },
  ],
  anthropic: [
    { label: "Claude Opus 4.8", value: "claude-opus-4-8" },
    { label: "Claude Sonnet 5", value: "claude-sonnet-5" },
    { label: "Claude Haiku 4.5", value: "claude-haiku-4-5" },
    { label: "Claude Fable 5", value: "claude-fable-5" },
  ],
  openrouter: [
    { label: "Claude Opus 4.7", value: "anthropic/claude-opus-4.7" },
    { label: "Claude Haiku 4.5", value: "anthropic/claude-haiku-4.5" },
    { label: "GPT-5 Mini", value: "openai/gpt-5-mini" },
    { label: "Gemini 2.5 Pro", value: "google/gemini-2.5-pro" },
    { label: "Gemini 2.5 Flash", value: "google/gemini-2.5-flash" },
    { label: "DeepSeek Chat", value: "deepseek/deepseek-chat" },
  ],
  zai: [
    { label: "GLM-5.2", value: "glm-5.2" },
    { label: "GLM-5.1", value: "glm-5.1" },
    { label: "GLM-5 Turbo", value: "glm-5-turbo" },
    { label: "GLM-4.5 Air", value: "glm-4.5-air" },
  ],
  "zai-coding-cn": [
    { label: "GLM-5.2", value: "glm-5.2" },
    { label: "GLM-5.1", value: "glm-5.1" },
    { label: "GLM-5 Turbo", value: "glm-5-turbo" },
    { label: "GLM-4.5 Air", value: "glm-4.5-air" },
  ],
  google: [
    { label: "Gemini 3 Pro (preview)", value: "gemini-3-pro-preview" },
    { label: "Gemini 2.5 Pro", value: "gemini-2.5-pro" },
    { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
    { label: "Gemini 2.5 Flash-Lite", value: "gemini-2.5-flash-lite" },
    { label: "Gemini 2.0 Flash", value: "gemini-2.0-flash" },
  ],
  deepseek: [
    { label: "DeepSeek V4 Pro", value: "deepseek-v4-pro" },
    { label: "DeepSeek V4 Flash", value: "deepseek-v4-flash" },
  ],
  xai: [
    { label: "Grok 4.3", value: "grok-4.3" },
    { label: "Grok 3", value: "grok-3" },
    { label: "Grok 3 Fast", value: "grok-3-fast" },
  ],
  groq: [
    { label: "Llama 3.3 70B", value: "llama-3.3-70b-versatile" },
    { label: "Llama 3.1 8B Instant", value: "llama-3.1-8b-instant" },
    { label: "Qwen3 32B", value: "qwen/qwen3-32b" },
    { label: "GPT-OSS 120B", value: "openai/gpt-oss-120b" },
    { label: "GPT-OSS 20B", value: "openai/gpt-oss-20b" },
  ],
  mistral: [
    { label: "Mistral Large", value: "mistral-large-latest" },
    { label: "Mistral Medium", value: "mistral-medium-2508" },
    { label: "Ministral 8B", value: "ministral-8b-latest" },
    { label: "Ministral 3B", value: "ministral-3b-latest" },
  ],
  moonshotai: [
    { label: "Kimi K2.6", value: "kimi-k2.6" },
    { label: "Kimi K2 Thinking", value: "kimi-k2-thinking" },
    { label: "Kimi K2 Turbo", value: "kimi-k2-turbo-preview" },
    { label: "Kimi K2 0905", value: "kimi-k2-0905-preview" },
  ],
  custom: [],
};

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  zai: "Z.ai Coding Plan",
  "zai-coding-cn": "Zhipu Coding Plan",
  google: "Google Gemini",
  deepseek: "DeepSeek",
  xai: "xAI (Grok)",
  groq: "Groq",
  mistral: "Mistral",
  moonshotai: "Moonshot (Kimi)",
  custom: "Custom (OpenAI-compatible)",
};

/** Where to get an API key, per provider (used by the Settings hint links). */
export const PROVIDER_KEY_URLS: Partial<Record<AIProvider, string>> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  openrouter: "https://openrouter.ai/keys",
  google: "https://aistudio.google.com/apikey",
  deepseek: "https://platform.deepseek.com/api_keys",
  xai: "https://console.x.ai",
  groq: "https://console.groq.com/keys",
  mistral: "https://console.mistral.ai/api-keys",
  moonshotai: "https://platform.moonshot.ai/console/api-keys",
};
