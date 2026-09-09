/**
 * AI Configuration storage and types for BYOK (Bring Your Own Key) model
 */

import {
  DEFAULT_CUSTOM_OPENAI_API,
  DEFAULT_READAWARE_MODEL,
  LEGACY_CUSTOM_OPENAI_API,
  READAWARE_MODEL_IDS,
  isCustomOpenAIApi,
  normalizeCustomOpenAIBaseUrl,
  type CustomOpenAIApi,
  type ThinkingLevel,
} from "@read-aware/agent";

/**
 * 产品 BYO-key 面可配置的 provider：KNOWN_PROVIDERS 去掉 OAuth 订阅式
 * 条目（openai-codex 走 pi CLI 的 OAuth 登录，产品没有对应登录流，
 * 只服务 eval/dev 链路）。
 */

export type AIProvider =
  | "readaware"
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
  | "ollama-cloud"
  | "custom";

/**
 * OpenRouter 上游路由偏好（仅 provider = openrouter 时生效）。整体作为
 * 请求体的 `provider` 字段发给 OpenRouter：order 是有序的上游 slug 列表
 * （如 "coreweave", "deepinfra"），sort 是无指定上游时的排序策略。
 */
export interface OpenRouterRoutingConfig {
  /** 排序策略；undefined = OpenRouter 默认（负载均衡）。 */
  sort?: "price" | "throughput" | "latency";
  /** 优先上游 slug（有序）；空数组视同未设置。 */
  order?: string[];
  /** 指定上游不可用时允许回退到其他上游；默认 true。 */
  allowFallbacks?: boolean;
}

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  /** The "smart" tier model (chat, onboarding, synthesis). */
  model: string;
  /** Optional advanced override for the "fast" tier. Falls back to `model`. */
  fastModel?: string;
  /** Thinking effort for the smart tier. New configurations default to Medium;
   *  models without thinking support ignore it. */
  thinkingLevel?: ThinkingLevel;
  /** Thinking effort for the fast tier. */
  fastThinkingLevel?: ThinkingLevel;
  customBaseUrl?: string;
  customApi?: CustomOpenAIApi;
  customSupportsThinking?: boolean;
  /** Undefined lets a custom upstream choose its own output limit. */
  customMaxOutputTokens?: number;
  /** OpenRouter 专属：上游路由偏好。 */
  openRouterRouting?: OpenRouterRoutingConfig;
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

/** Connection settings remembered per provider (models, efforts, custom endpoint). */
type ProviderSettings = {
  model?: string;
  openRouterRouting?: OpenRouterRoutingConfig;
  fastModel?: string;
  thinkingLevel?: ThinkingLevel;
  fastThinkingLevel?: ThinkingLevel;
  customBaseUrl?: string;
  customApi?: CustomOpenAIApi;
  customSupportsThinking?: boolean;
  customMaxOutputTokens?: number;
};

export type ResolvedProviderSettings = {
  model: string;
  openRouterRouting?: OpenRouterRoutingConfig;
  fastModel: string;
  thinkingLevel: ThinkingLevel;
  fastThinkingLevel: ThinkingLevel;
  customBaseUrl: string;
  customApi: CustomOpenAIApi;
  customSupportsThinking: boolean;
  customMaxOutputTokens?: number;
};

/**
 * The persisted blob: the active provider plus a per-provider settings map.
 * The top-level model fields are the pre-split shape — read as a fallback
 * for their then-active provider, dropped on the next save.
 */
type StoredAIConfig = Partial<AIConfig> & {
  models?: Partial<Record<AIProvider, ProviderSettings>>;
};

/** The simple setup path enables reasoning for both model roles. */
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";

/** 存储层的路由偏好消毒：slug 去空白/小写，空对象归一成 undefined。 */
function sanitizeOpenRouterRouting(
  value: OpenRouterRoutingConfig | undefined,
): OpenRouterRoutingConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const sort =
    value.sort === "price" || value.sort === "throughput" || value.sort === "latency"
      ? value.sort
      : undefined;
  const order = Array.isArray(value.order)
    ? value.order
        .map((slug) => String(slug).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const allowFallbacks = value.allowFallbacks !== false;
  if (!sort && order.length === 0) return undefined;
  return {
    ...(sort ? { sort } : {}),
    ...(order.length ? { order } : {}),
    allowFallbacks,
  };
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

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
export function getStoredProviderSettings(
  provider: AIProvider,
): ResolvedProviderSettings {
  const stored = readStored();
  const entry = stored?.models?.[provider];
  const legacy = stored?.provider === provider ? stored : undefined;
  const model = entry?.model ?? legacy?.model ?? DEFAULT_MODELS[provider] ?? "";
  const explicitFastModel = entry?.fastModel ?? legacy?.fastModel;
  const hasSeparateFastModel = Boolean(
    explicitFastModel && explicitFastModel !== model,
  );
  // Missing thinking fields in a remembered config mean the old implicit Off
  // default. A provider the user has never configured gets the new Medium
  // default instead, so existing users do not silently incur extra usage.
  const thinkingDefault = entry || legacy ? "off" : DEFAULT_THINKING_LEVEL;
  const thinkingLevel =
    entry?.thinkingLevel ?? legacy?.thinkingLevel ?? thinkingDefault;
  const storedCustomApi = entry?.customApi ?? legacy?.customApi;
  // Existing Custom configurations used Responses implicitly. Preserve that
  // behavior; only a never-configured Custom provider starts on the more
  // widely compatible Chat Completions format.
  const customApi = isCustomOpenAIApi(storedCustomApi)
    ? storedCustomApi
    : provider === "custom" && (entry || legacy)
      ? LEGACY_CUSTOM_OPENAI_API
      : DEFAULT_CUSTOM_OPENAI_API;
  return {
    model,
    openRouterRouting:
      provider === "openrouter"
        ? sanitizeOpenRouterRouting(entry?.openRouterRouting)
        : undefined,
    fastModel: hasSeparateFastModel ? (explicitFastModel ?? model) : model,
    thinkingLevel,
    fastThinkingLevel: hasSeparateFastModel
      ? entry?.fastThinkingLevel ?? legacy?.fastThinkingLevel ?? thinkingDefault
      : thinkingLevel,
    customBaseUrl: entry?.customBaseUrl ?? legacy?.customBaseUrl ?? "",
    customApi,
    customSupportsThinking: Boolean(
      entry?.customSupportsThinking ?? legacy?.customSupportsThinking,
    ),
    customMaxOutputTokens: positiveInteger(
      entry?.customMaxOutputTokens ?? legacy?.customMaxOutputTokens,
    ),
  };
}

// Two seams, split by sensitivity. The connection fields (provider / model /
// customBaseUrl) are ordinary device-local config and live in the kv store; the
// API key is a credential and goes through platform/secret-store, which keeps
// it encrypted at rest. Neither is reachable from webview script — the key used
// to sit in localStorage, where every plugin could read it.
export const AI_CONFIG_KEY = "read-aware-ai-config";
const CONFIG_KEY = AI_CONFIG_KEY;

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
    const settings = getStoredProviderSettings(parsed.provider);
    return {
      provider: parsed.provider,
      apiKey,
      ...settings,
    };
  } catch {
    return null;
  }
}

/** Encode non-secret preferences for both native UI saves and atomic domain commands. */
export function encodeAIConfig(config: AIConfig): string {
  const {
    provider,
    model,
    fastModel,
    thinkingLevel,
    fastThinkingLevel,
    customBaseUrl,
    customApi,
    customSupportsThinking,
    customMaxOutputTokens,
    openRouterRouting,
  } = config;
  const hasSeparateFastModel = Boolean(fastModel && fastModel !== model);
  const resolvedThinkingLevel = thinkingLevel ?? DEFAULT_THINKING_LEVEL;
  const resolvedCustomMaxOutputTokens = positiveInteger(customMaxOutputTokens);
  // Merge this provider's settings into the map; other providers keep theirs.
  const models = { ...(readStored()?.models ?? {}) };
  const resolvedRouting =
    provider === "openrouter" ? sanitizeOpenRouterRouting(openRouterRouting) : undefined;
  models[provider] = {
    model,
    ...(resolvedRouting ? { openRouterRouting: resolvedRouting } : {}),
    fastModel: hasSeparateFastModel ? fastModel : undefined,
    // Persist Off explicitly now that new providers default to Medium. This
    // keeps a deliberate opt-out stable across provider switches and reloads.
    thinkingLevel: resolvedThinkingLevel,
    fastThinkingLevel: hasSeparateFastModel
      ? fastThinkingLevel ?? DEFAULT_THINKING_LEVEL
      : resolvedThinkingLevel,
    ...(provider === "custom"
      ? {
          ...(customBaseUrl
            ? { customBaseUrl: normalizeCustomOpenAIBaseUrl(customBaseUrl) }
            : {}),
          customApi: isCustomOpenAIApi(customApi)
            ? customApi
            : DEFAULT_CUSTOM_OPENAI_API,
          customSupportsThinking: Boolean(customSupportsThinking),
          ...(resolvedCustomMaxOutputTokens
            ? { customMaxOutputTokens: resolvedCustomMaxOutputTokens }
            : {}),
        }
      : {}),
  };
  return JSON.stringify({ provider, models } satisfies StoredAIConfig);
}

export function saveAIConfig(config: AIConfig): void {
  const { provider, apiKey } = config;
  localKV.setItem(CONFIG_KEY, encodeAIConfig(config));
  // Reactive settings rewrite this record as fields change. Avoid needless
  // encrypted-store IPC when the credential itself did not change.
  const slot = keySlot(provider);
  const storedApiKey = getSecret(slot);
  if (apiKey && storedApiKey !== apiKey) {
    setSecret(slot, apiKey);
  } else if (!apiKey && storedApiKey) {
    deleteSecret(slot);
  }
  // The single-slot era key must not linger as a fallback for OTHER providers.
  if (getSecret("ai-api-key")) deleteSecret("ai-api-key");
}

export function clearAIConfig(): void {
  localKV.removeItem(CONFIG_KEY);
  deleteSecret("ai-api-key");
  for (const provider of Object.keys(DEFAULT_MODELS) as AIProvider[]) {
    deleteSecret(keySlot(provider));
  }
}

// A new BYO setup stays unselected until the user chooses a remote model.
export const DEFAULT_MODELS: Record<AIProvider, string> = {
  readaware: DEFAULT_READAWARE_MODEL,
  openai: "", anthropic: "", openrouter: "", zai: "", "zai-coding-cn": "",
  google: "", deepseek: "", xai: "", groq: "", mistral: "", moonshotai: "",
  "ollama-cloud": "", custom: "",
};

export type { ThinkingLevel };

export const THINKING_LEVELS: ThinkingLevel[] = [
  "off", "minimal", "low", "medium", "high", "xhigh", "max",
];

// A first-party service contract, not a BYO discovery list.
export const SUBSCRIPTION_MODELS = READAWARE_MODEL_IDS.map((id) => ({
  label: id, value: id,
}));

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  readaware: "ReadAware AI",
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
  "ollama-cloud": "Ollama Cloud",
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
  "ollama-cloud": "https://ollama.com/settings/keys",
};
