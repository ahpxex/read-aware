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
import { ollamaCloudProvider } from "../models/ollama-cloud";

import type { ProviderRegistry } from "../models/registry";
export function buildBuiltinProviderRegistry(options?: Parameters<typeof createModels>[0]): ProviderRegistry {
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
