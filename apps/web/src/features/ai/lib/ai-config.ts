/**
 * AI Configuration storage and types for BYOK (Bring Your Own Key) model
 */

import {
  DEFAULT_CUSTOM_OPENAI_API,
  DEFAULT_READAWARE_MODEL,
  LEGACY_CUSTOM_OPENAI_API,
  getProviderModelCatalog,
  isCustomOpenAIApi,
  normalizeCustomOpenAIBaseUrl,
  type CustomOpenAIApi,
  type KnownProviderId,
  type ThinkingLevel,
} from "@read-aware/agent";

/**
 * 产品 BYO-key 面可配置的 provider：KNOWN_PROVIDERS 去掉 OAuth 订阅式
 * 条目（openai-codex 走 pi CLI 的 OAuth 登录，产品没有对应登录流，
 * 只服务 eval/dev 链路）。
 */
type ByoProviderId = Exclude<KnownProviderId, "openai-codex">;

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
import { publishRoamingSecret } from "../../../platform/roaming-preferences";
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

export function saveAIConfig(config: AIConfig): void {
  const {
    apiKey,
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
  localKV.setItem(CONFIG_KEY, JSON.stringify({ provider, models } satisfies StoredAIConfig));
  // Reactive settings rewrite this record as fields change. Avoid needless
  // encrypted-store IPC when the credential itself did not change.
  const slot = keySlot(provider);
  const storedApiKey = getSecret(slot);
  if (apiKey && storedApiKey !== apiKey) {
    setSecret(slot, apiKey);
    // The credential roams too — SEALED with the sync master key before it
    // enters the log, so other devices on this passphrase unlock it while
    // every at-rest copy stays ciphertext.
    publishRoamingSecret(slot, apiKey);
  } else if (!apiKey && storedApiKey) {
    deleteSecret(slot);
    publishRoamingSecret(slot, null);
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

// Default "smart" model for each provider (chat, onboarding, synthesis).
export const DEFAULT_MODELS: Record<AIProvider, string> = {
  readaware: DEFAULT_READAWARE_MODEL,
  openai: "gpt-5.5",
  anthropic: "claude-opus-5",
  openrouter: "~anthropic/claude-opus-latest",
  zai: "glm-5.2",
  "zai-coding-cn": "glm-5.2",
  google: "gemini-3.1-pro-preview",
  deepseek: "deepseek-v4-pro",
  xai: "grok-4.5",
  groq: "openai/gpt-oss-120b",
  mistral: "mistral-large-latest",
  moonshotai: "kimi-k3",
  "ollama-cloud": "deepseek-v4-flash:0731",
  custom: "",
};

// Suggested model when an advanced user opts into a separate cheap/quick tier.
// The default path does not use this table: Fast follows the primary model.
export const SUGGESTED_FAST_MODELS: Record<AIProvider, string> = {
  readaware: DEFAULT_READAWARE_MODEL,
  openai: "gpt-5.4-mini",
  anthropic: "claude-haiku-4-5",
  openrouter: "~openai/gpt-mini-latest",
  zai: "glm-5-turbo",
  "zai-coding-cn": "glm-5-turbo",
  google: "gemini-flash-latest",
  deepseek: "deepseek-v4-flash",
  xai: "grok-4.3",
  groq: "openai/gpt-oss-20b",
  mistral: "mistral-small-latest",
  moonshotai: "kimi-k2.7-code-highspeed",
  "ollama-cloud": "gpt-oss:20b",
  custom: "",
};

export type { ThinkingLevel };

// Thinking-effort choices, in escalation order (shared by both effort dropdowns).
// pi maps them per provider; models without thinking support ignore them.
export const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

// A short, reading-relevant subset of pi-ai's current catalog. pi-ai remains
// the source of truth for model IDs and display names; this list only keeps the
// picker focused instead of exposing every dated snapshot and legacy family.
const RECOMMENDED_MODEL_IDS = {
  openai: [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.5-pro",
    "gpt-5.4",
    "gpt-5.4-pro",
    "gpt-5.4-mini",
  ],
  anthropic: [
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-fable-5",
    "claude-opus-4-8",
    "claude-haiku-4-5",
  ],
  openrouter: [
    "auto",
    "~anthropic/claude-opus-latest",
    "~anthropic/claude-sonnet-latest",
    "~anthropic/claude-fable-latest",
    "~anthropic/claude-haiku-latest",
    "~openai/gpt-latest",
    "~openai/gpt-mini-latest",
    "~google/gemini-pro-latest",
    "~google/gemini-flash-latest",
    "~moonshotai/kimi-latest",
    "~x-ai/grok-latest",
  ],
  zai: ["glm-5.2", "glm-5.1", "glm-5-turbo"],
  "zai-coding-cn": ["glm-5.2", "glm-5.1", "glm-5-turbo"],
  google: [
    "gemini-3.1-pro-preview",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
  ],
  deepseek: ["deepseek-v4-pro", "deepseek-v4-flash"],
  xai: ["grok-4.5", "grok-4.3"],
  groq: [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3-32b",
    "meta-llama/llama-4-scout-17b-16e-instruct",
  ],
  mistral: [
    "mistral-large-latest",
    "mistral-medium-latest",
    "mistral-small-latest",
    "magistral-medium-latest",
    "ministral-8b-latest",
  ],
  moonshotai: [
    "kimi-k3",
    "kimi-k2.7-code-highspeed",
    "kimi-k2.7-code",
    "kimi-k2.6",
  ],
  "ollama-cloud": [
    "deepseek-v4-flash:0731",
    "gpt-oss:120b",
    "gpt-oss:20b",
    "minimax-m3",
    "kimi-k2.6",
    "qwen3.5:397b",
  ],
} as const satisfies Record<ByoProviderId, readonly string[]>;

function recommendedModelOptions(provider: ByoProviderId) {
  const catalog = new Map(
    getProviderModelCatalog(provider).map((entry) => [entry.id, entry]),
  );
  return RECOMMENDED_MODEL_IDS[provider].flatMap((id) => {
    const entry = catalog.get(id);
    return entry ? [{ label: entry.name, value: entry.id }] : [];
  });
}

export const PROVIDER_MODELS: Record<
  AIProvider,
  { label: string; value: string }[]
> = {
  // The subscription catalog — keep in lockstep with the relay's aiModels
  // (apps/relay/src/ai-proxy.ts); the proxy refuses anything else anyway.
  readaware: [
    { label: "DeepSeek V4 Flash", value: "deepseek-v4-flash" },
    { label: "DeepSeek V4 Pro", value: "deepseek-v4-pro" },
  ],
  openai: recommendedModelOptions("openai"),
  anthropic: recommendedModelOptions("anthropic"),
  openrouter: recommendedModelOptions("openrouter"),
  zai: recommendedModelOptions("zai"),
  "zai-coding-cn": recommendedModelOptions("zai-coding-cn"),
  google: recommendedModelOptions("google"),
  deepseek: recommendedModelOptions("deepseek"),
  xai: recommendedModelOptions("xai"),
  groq: recommendedModelOptions("groq"),
  mistral: recommendedModelOptions("mistral"),
  moonshotai: recommendedModelOptions("moonshotai"),
  "ollama-cloud": recommendedModelOptions("ollama-cloud"),
  custom: [],
};

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
