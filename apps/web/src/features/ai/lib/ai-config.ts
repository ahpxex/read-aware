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
import {
  deleteSecret,
  getSecret,
  setSecret,
  type SecretKey,
} from "../../../platform/secret-store";

/**
 * One credential slot PER provider — switching providers must never clobber
 * another provider's key. The pre-split era used a single "ai-api-key" slot;
 * it is adopted into the saved provider's slot on first read and never
 * written again.
 */
const keySlot = (provider: AIProvider): SecretKey => `ai-api-key.${provider}`;

/** The saved key for one provider ("" when none) — provider-switch UIs use it. */
export function getStoredApiKey(provider: AIProvider): string {
  return getSecret(keySlot(provider));
}

/** Connection settings remembered per provider (models, custom endpoint). */
type ProviderSettings = { model?: string; fastModel?: string; customBaseUrl?: string };

/**
 * The persisted blob: the active provider plus a per-provider settings map.
 * The top-level model fields are the pre-split shape — read as a fallback
 * for their then-active provider, dropped on the next save.
 */
type StoredAIConfig = Partial<AIConfig> & {
  models?: Partial<Record<AIProvider, ProviderSettings>>;
};

function readStored(): StoredAIConfig | null {
  try {
    const raw = localKV.getItem(CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAIConfig;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * A provider's remembered settings, falling back to its defaults — what the
 * settings panel shows when the user switches to it.
 */
export function getStoredProviderSettings(provider: AIProvider): Required<ProviderSettings> {
  const stored = readStored();
  const entry = stored?.models?.[provider];
  const legacy = stored?.provider === provider ? stored : undefined;
  return {
    model: entry?.model ?? legacy?.model ?? DEFAULT_MODELS[provider] ?? "",
    fastModel: entry?.fastModel ?? legacy?.fastModel ?? FAST_DEFAULT_MODELS[provider] ?? "",
    customBaseUrl: entry?.customBaseUrl ?? legacy?.customBaseUrl ?? "",
  };
}

// Two seams, split by sensitivity. The connection fields (provider / model /
// customBaseUrl) are ordinary device-local config and live in the kv store; the
// API key is a credential and goes through platform/secret-store, which keeps
// it encrypted at rest. Neither is reachable from webview script — the key used
// to sit in localStorage, where every plugin could read it.
const CONFIG_KEY = "read-aware-ai-config";

export function getAIConfig(): AIConfig | null {
  try {
    const parsed = readStored();
    if (!parsed?.provider) return null;
    const slot = keySlot(parsed.provider);
    let apiKey = getSecret(slot);
    if (!apiKey) {
      // Single-slot era: that key was saved together with the provider in
      // this very blob, so it belongs to this provider's slot. Adopt once.
      const legacy = getSecret("ai-api-key");
      if (legacy) {
        setSecret(slot, legacy);
        deleteSecret("ai-api-key");
        apiKey = legacy;
      }
    }
    // `parsed.apiKey` is the pre-secret-store record shape; it migrates out
    // on the next save (saveAIConfig never writes the key back into this blob).
    apiKey = apiKey || parsed.apiKey || "";
    const entry = parsed.models?.[parsed.provider];
    return {
      provider: parsed.provider,
      apiKey,
      model: entry?.model ?? parsed.model ?? "",
      fastModel: entry?.fastModel ?? parsed.fastModel,
      customBaseUrl: entry?.customBaseUrl ?? parsed.customBaseUrl,
    };
  } catch {
    return null;
  }
}

export function saveAIConfig(config: AIConfig): void {
  const { apiKey, provider, model, fastModel, customBaseUrl } = config;
  // Merge this provider's settings into the map; other providers keep theirs.
  const models = { ...(readStored()?.models ?? {}) };
  models[provider] = {
    model,
    fastModel,
    ...(customBaseUrl ? { customBaseUrl } : {}),
  };
  localKV.setItem(CONFIG_KEY, JSON.stringify({ provider, models } satisfies StoredAIConfig));
  if (apiKey) setSecret(keySlot(provider), apiKey);
  else deleteSecret(keySlot(provider));
  // The single-slot era key must not linger as a fallback for OTHER providers.
  deleteSecret("ai-api-key");
}

export function clearAIConfig(): void {
  localKV.removeItem(CONFIG_KEY);
  deleteSecret("ai-api-key");
  for (const provider of Object.keys(DEFAULT_MODELS) as AIProvider[]) {
    deleteSecret(keySlot(provider));
  }
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
