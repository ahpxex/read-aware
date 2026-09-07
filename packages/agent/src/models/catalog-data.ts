import type { Api, Model, ModelCost, ModelCostRates } from "@earendil-works/pi-ai";
import { AppError, ERR_AI_PROVIDER } from "@read-aware/core";
import { createCustomOpenAIModel } from "./custom-openai";
import { PROVIDER_DEFINITIONS, providerBaseUrl, supportsProviderApi, type KnownProviderId } from "./provider-definitions";

export type CatalogModel = Model<Api>;
export type CatalogCache = {
  version: 1;
  models: CatalogModel[];
  retained: CatalogModel[];
  checkedAt: number;
  etag?: string;
};

function invalid(): never {
  throw new AppError(ERR_AI_PROVIDER, "Invalid remote model catalog", { retryable: true });
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function parseRates(value: unknown): ModelCostRates {
  if (!record(value)) invalid();
  const { input, output, cacheRead, cacheWrite } = value;
  if (typeof input !== "number" || typeof output !== "number" ||
    typeof cacheRead !== "number" || typeof cacheWrite !== "number" ||
    [input, output, cacheRead, cacheWrite].some((rate) => !Number.isFinite(rate))) invalid();
  // Routing aliases use negative rates for unknown pricing. Pi requires numbers;
  // omit these unknown costs from estimates rather than calculating negative spend.
  return {
    input: Math.max(0, input), output: Math.max(0, output),
    cacheRead: Math.max(0, cacheRead), cacheWrite: Math.max(0, cacheWrite),
  };
}

function parseCost(value: Record<string, unknown>): ModelCost {
  const cost: ModelCost = parseRates(value);
  if (value.tiers !== undefined) {
    if (!Array.isArray(value.tiers)) invalid();
    cost.tiers = value.tiers.map((tier) => {
      if (!record(tier) || !positive(tier.inputTokensAbove)) invalid();
      return { ...parseRates(tier), inputTokensAbove: tier.inputTokensAbove };
    });
  }
  return cost;
}

/** Only model metadata may cross this boundary, never request destinations or headers. */
export function parseCatalogModels(provider: KnownProviderId, value: unknown): CatalogModel[] {
  const entries = Array.isArray(value) ? value : record(value) ? Object.values(value) : invalid();
  if (entries.length > 5_000) invalid();
  const ids = new Set<string>();
  return entries.map((entry) => {
    if (!record(entry) || typeof entry.id !== "string" || !entry.id.trim() || entry.id.length > 512 ||
      typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 512 ||
      typeof entry.api !== "string" || !supportsProviderApi(provider, entry.api) ||
      entry.provider !== provider || typeof entry.reasoning !== "boolean" ||
      !Array.isArray(entry.input) || !entry.input.includes("text") ||
      entry.input.some((kind) => kind !== "text" && kind !== "image") ||
      !positive(entry.contextWindow) || !positive(entry.maxTokens) || !record(entry.cost) ||
      ids.has(entry.id)) invalid();
    ids.add(entry.id);
    const cost = parseCost(entry.cost);
    if (entry.compat !== undefined && !record(entry.compat)) invalid();
    if (entry.thinkingLevelMap !== undefined && (!record(entry.thinkingLevelMap) ||
      Object.values(entry.thinkingLevelMap).some((level) => level !== null && typeof level !== "string" && typeof level !== "number"))) invalid();
    return {
      id: entry.id,
      name: entry.name,
      provider,
      api: entry.api,
      baseUrl: providerBaseUrl(provider, entry.api),
      reasoning: entry.reasoning,
      input: entry.input,
      cost,
      contextWindow: entry.contextWindow,
      maxTokens: entry.maxTokens,
      ...(entry.compat ? { compat: entry.compat } : {}),
      ...(entry.thinkingLevelMap ? { thinkingLevelMap: entry.thinkingLevelMap } : {}),
    } as CatalogModel;
  });
}

export function parseCatalogCache(provider: KnownProviderId, value: unknown): CatalogCache {
  if (!record(value) || value.version !== 1 || typeof value.checkedAt !== "number" ||
    !Number.isFinite(value.checkedAt) || value.checkedAt < 0 ||
    !Array.isArray(value.models) || !Array.isArray(value.retained) ||
    (value.etag !== undefined && typeof value.etag !== "string")) invalid();
  return {
    version: 1,
    models: parseCatalogModels(provider, value.models),
    retained: parseCatalogModels(provider, value.retained),
    checkedAt: value.checkedAt,
    etag: value.etag as string | undefined,
  };
}

export function parseOllamaCatalog(value: unknown): CatalogModel[] {
  if (!record(value) || !Array.isArray(value.data) || value.data.length > 5_000) invalid();
  const ids = new Set<string>();
  return value.data.map((entry) => {
    if (!record(entry) || typeof entry.id !== "string" || !entry.id.trim() || entry.id.length > 512 || ids.has(entry.id)) invalid();
    ids.add(entry.id);
    return createCustomOpenAIModel(entry.id, {
      providerId: "ollama-cloud",
      baseUrl: PROVIDER_DEFINITIONS["ollama-cloud"].baseUrl,
      api: "openai-completions",
      supportsThinking: true,
      maxOutputTokens: 16_384,
    });
  });
}
