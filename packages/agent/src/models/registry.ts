import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { zaiProvider } from "@earendil-works/pi-ai/providers/zai";
import { zaiCodingCnProvider } from "@earendil-works/pi-ai/providers/zai-coding-cn";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import { groqProvider } from "@earendil-works/pi-ai/providers/groq";
import { mistralProvider } from "@earendil-works/pi-ai/providers/mistral";
import { moonshotaiProvider } from "@earendil-works/pi-ai/providers/moonshotai";
import { ollamaCloudProvider } from "./ollama-cloud";

/** 目前接入的 provider；扩展时同步更新 buildProviderRegistry。 */
export const KNOWN_PROVIDERS = [
  "anthropic",
  "openai",
  "openai-codex",
  "openrouter",
  "zai",
  "zai-coding-cn",
  "google",
  "deepseek",
  "xai",
  "groq",
  "mistral",
  "moonshotai",
  "ollama-cloud",
] as const;
export type KnownProviderId = (typeof KNOWN_PROVIDERS)[number];

export type ProviderRegistry = ReturnType<typeof createModels>;

export type ProviderModelCatalogEntry = {
  id: string;
  name: string;
  reasoning: boolean;
  /** USD per million tokens（产品的模型选择器展示用；目录缺价则 undefined）。 */
  cost?: { input: number; output: number };
};

export function buildProviderRegistry(options?: Parameters<typeof createModels>[0]): ProviderRegistry {
  const models = createModels(options);
  models.setProvider(anthropicProvider());
  models.setProvider(openaiProvider());
  models.setProvider(openaiCodexProvider());
  models.setProvider(openrouterProvider());
  models.setProvider(zaiProvider());
  models.setProvider(zaiCodingCnProvider());
  models.setProvider(googleProvider());
  models.setProvider(deepseekProvider());
  models.setProvider(xaiProvider());
  models.setProvider(groqProvider());
  models.setProvider(mistralProvider());
  models.setProvider(moonshotaiProvider());
  models.setProvider(ollamaCloudProvider());
  return models;
}

let catalogRegistry: ProviderRegistry | undefined;

/**
 * Model metadata shipped by pi-ai for a provider. The SDK owns compatibility
 * details; product surfaces can curate this catalog without duplicating model
 * labels or advertising models the runtime cannot resolve.
 */
export function getProviderModelCatalog(
  provider: KnownProviderId,
): ProviderModelCatalogEntry[] {
  catalogRegistry ??= buildProviderRegistry();
  return catalogRegistry.getModels(provider).map(({ id, name, reasoning, cost }) => ({
    id,
    name,
    reasoning,
    ...(cost ? { cost: { input: cost.input, output: cost.output } } : {}),
  }));
}
