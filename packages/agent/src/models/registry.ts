import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { zaiProvider } from "@earendil-works/pi-ai/providers/zai";
import { zaiCodingCnProvider } from "@earendil-works/pi-ai/providers/zai-coding-cn";

/** 目前接入的 provider；扩展时同步更新 buildProviderRegistry。 */
export const KNOWN_PROVIDERS = [
  "anthropic",
  "openai",
  "openrouter",
  "zai",
  "zai-coding-cn",
] as const;
export type KnownProviderId = (typeof KNOWN_PROVIDERS)[number];

export type ProviderRegistry = ReturnType<typeof createModels>;

export function buildProviderRegistry(): ProviderRegistry {
  const models = createModels();
  models.setProvider(anthropicProvider());
  models.setProvider(openaiProvider());
  models.setProvider(openrouterProvider());
  models.setProvider(zaiProvider());
  models.setProvider(zaiCodingCnProvider());
  return models;
}
