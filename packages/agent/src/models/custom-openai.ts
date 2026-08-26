import {
  createProvider,
  envApiKeyAuth,
  type Model,
  type MutableModels,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { customOpenAICompletionsApi } from "./custom-openai-completions";
import { downlevelCustomToolSchemas } from "./custom-openai-schema";

export const CUSTOM_OPENAI_PROVIDER_ID = "custom-openai";
export const DEFAULT_CUSTOM_OPENAI_API = "openai-completions";
export const LEGACY_CUSTOM_OPENAI_API = "openai-responses";

export const CUSTOM_OPENAI_APIS = [
  "openai-completions",
  "openai-responses",
] as const;

export type CustomOpenAIApi = (typeof CUSTOM_OPENAI_APIS)[number];

const DEFAULT_CONTEXT_WINDOW = 128_000;
const INTERNAL_DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const OPENAI_ENDPOINT_SUFFIXES = [
  "/chat/completions",
  "/responses",
  "/completions",
] as const;

export type CustomOpenAIProviderConfig = {
  baseUrl: string;
  api: CustomOpenAIApi;
  modelIds: readonly string[];
  supportsThinking?: boolean;
  /** Undefined means the upstream chooses its own output limit. */
  maxOutputTokens?: number;
  /**
   * Provider id stamped onto every built model. Defaults to the user-configured
   * "custom-openai" provider; named providers that merely REUSE this adapter
   * (Ollama Cloud) must pass their own id, or the runtime dispatches the model
   * to a provider that is not registered ("Unknown provider: custom-openai").
   */
  providerId?: string;
};

export function isCustomOpenAIApi(value: unknown): value is CustomOpenAIApi {
  return CUSTOM_OPENAI_APIS.includes(value as CustomOpenAIApi);
}

/** Accept either an SDK base URL or a pasted concrete OpenAI endpoint. */
export function normalizeCustomOpenAIBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed.replace(/\/+$/, "");
  }

  url.hash = "";
  let path = url.pathname.replace(/\/+$/, "");
  const lowerPath = path.toLowerCase();
  const endpoint = OPENAI_ENDPOINT_SUFFIXES.find((suffix) =>
    lowerPath.endsWith(suffix),
  );
  if (endpoint) path = path.slice(0, -endpoint.length);
  url.pathname = path || "/";

  const serialized = url.toString();
  const searchStart = serialized.indexOf("?");
  const base = searchStart >= 0 ? serialized.slice(0, searchStart) : serialized;
  const search = searchStart >= 0 ? serialized.slice(searchStart) : "";
  return base.replace(/\/$/, "") + search;
}

function positiveInteger(value: number | undefined): number | undefined {
  if (!Number.isFinite(value) || !value || value <= 0) return undefined;
  return Math.floor(value);
}

export function createCustomOpenAIModel(
  id: string,
  config: Omit<CustomOpenAIProviderConfig, "modelIds">,
): Model<CustomOpenAIApi> {
  const maxTokens =
    positiveInteger(config.maxOutputTokens) ?? INTERNAL_DEFAULT_MAX_OUTPUT_TOKENS;
  const common = {
    id,
    name: id,
    api: config.api,
    provider: config.providerId ?? CUSTOM_OPENAI_PROVIDER_ID,
    baseUrl: normalizeCustomOpenAIBaseUrl(config.baseUrl),
    reasoning: Boolean(config.supportsThinking),
    input: ["text"] as ("text" | "image")[],
    cost: ZERO_COST,
    contextWindow: Math.max(DEFAULT_CONTEXT_WINDOW, maxTokens + 4_096),
    maxTokens,
  };

  if (config.api === "openai-completions") {
    return {
      ...common,
      api: config.api,
      compat: {
        // Custom gateways usually implement the common subset, not every
        // first-party OpenAI extension. Users can still opt into thinking.
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: Boolean(config.supportsThinking),
        supportsUsageInStreaming: false,
        maxTokensField: "max_tokens",
        supportsStrictMode: false,
        supportsOpenAIGrammarTools: false,
        supportsLongCacheRetention: false,
      },
    };
  }

  return {
    ...common,
    api: config.api,
    compat: {
      supportsDeveloperRole: false,
      supportsLongCacheRetention: false,
      supportsStrictMode: false,
      supportsOpenAIGrammarTools: false,
      supportsToolSearch: false,
      supportsExplicitPromptCacheMode: false,
    },
  };
}

export function registerCustomOpenAIProvider(
  registry: MutableModels,
  config: CustomOpenAIProviderConfig,
): void {
  const modelIds = [...new Set(config.modelIds.map((id) => id.trim()).filter(Boolean))];
  if (modelIds.length === 0) {
    throw new Error("custom OpenAI-compatible provider requires at least one model id");
  }

  const api = {
    "openai-completions": customOpenAICompletionsApi(),
    "openai-responses": openAIResponsesApi(),
  } satisfies Record<CustomOpenAIApi, ProviderStreams>;

  registry.setProvider(
    createProvider({
      id: CUSTOM_OPENAI_PROVIDER_ID,
      name: "Custom OpenAI-compatible",
      baseUrl: normalizeCustomOpenAIBaseUrl(config.baseUrl),
      auth: { apiKey: envApiKeyAuth("Custom API key", []) },
      models: modelIds.map((id) => createCustomOpenAIModel(id, config)),
      api,
    }),
  );
}

/**
 * pi's simple API always derives a max-token field from model metadata. A
 * custom endpoint has no trustworthy catalog metadata, so leave that field to
 * the upstream unless the user explicitly configured a cap. Also omit
 * first-party Responses storage/cache extensions from compatibility requests.
 */
export function sanitizeCustomOpenAIPayload(
  payload: unknown,
  maxOutputTokens?: number,
): unknown {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return payload;
  }

  const next = { ...(payload as Record<string, unknown>) };
  delete next.store;
  delete next.prompt_cache_key;
  delete next.prompt_cache_retention;
  delete next.prompt_cache_options;
  delete next.include;

  if (next.tools !== undefined) {
    next.tools = downlevelCustomToolSchemas(next.tools);
  }

  if (positiveInteger(maxOutputTokens) === undefined) {
    delete next.max_tokens;
    delete next.max_completion_tokens;
    delete next.max_output_tokens;
  }

  return next;
}
