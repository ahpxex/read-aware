import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { zaiProvider } from "@earendil-works/pi-ai/providers/zai";
import { zaiCodingCnProvider } from "@earendil-works/pi-ai/providers/zai-coding-cn";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import { groqProvider } from "@earendil-works/pi-ai/providers/groq";
import { mistralProvider } from "@earendil-works/pi-ai/providers/mistral";
import { moonshotaiProvider } from "@earendil-works/pi-ai/providers/moonshotai";

/** 目前接入的 provider；扩展时同步更新 buildProviderRegistry。 */
export const KNOWN_PROVIDERS = [
  "anthropic",
  "openai",
  "openrouter",
  "zai",
  "zai-coding-cn",
  "google",
  "deepseek",
  "xai",
  "groq",
  "mistral",
  "moonshotai",
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
  models.setProvider(googleProvider());
  models.setProvider(deepseekProvider());
  models.setProvider(xaiProvider());
  models.setProvider(groqProvider());
  models.setProvider(mistralProvider());
  models.setProvider(moonshotaiProvider());
  return models;
}
