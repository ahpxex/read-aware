import { createModels, createProvider, envApiKeyAuth, type Api, type Model } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { mistralConversationsApi } from "@earendil-works/pi-ai/api/mistral-conversations.lazy";
import { customOpenAICompletionsApi } from "./custom-openai-completions";
import { KNOWN_PROVIDERS, PROVIDER_DEFINITIONS, type KnownProviderId } from "./provider-definitions";

export { KNOWN_PROVIDERS, type KnownProviderId } from "./provider-definitions";
export type ProviderRegistry = ReturnType<typeof createModels>;
export type ProviderModelCatalogEntry = Pick<Model<Api>, "id" | "name" | "reasoning"> & {
  cost?: { input: number; output: number };
};

type CatalogReader = (provider: KnownProviderId) => readonly Model<Api>[];
let readCatalog: CatalogReader = () => [];

/** The host supplies its hydrated device-local catalog, not bundled SDK inventories. */
export function setModelCatalogReader(reader: CatalogReader): void {
  readCatalog = reader;
}

export function buildProviderRegistry(options?: Parameters<typeof createModels>[0]): ProviderRegistry {
  const models = createModels(options);
  const apis = {
    "anthropic-messages": anthropicMessagesApi(),
    "openai-responses": openAIResponsesApi(),
    "openai-completions": openAICompletionsApi(),
    "openai-codex-responses": openAICodexResponsesApi(),
    "google-generative-ai": googleGenerativeAIApi(),
    "mistral-conversations": mistralConversationsApi(),
  };
  for (const id of KNOWN_PROVIDERS) {
    const definition = PROVIDER_DEFINITIONS[id];
    const provider = createProvider({
      id,
      baseUrl: definition.baseUrl,
      auth: { apiKey: envApiKeyAuth(id, [definition.env]) },
      models: [],
      api: id === "ollama-cloud" ? customOpenAICompletionsApi() : apis,
    });
    models.setProvider({ ...provider, getModels: () => readCatalog(id) });
  }
  return models;
}

export function getProviderModelCatalog(provider: KnownProviderId): ProviderModelCatalogEntry[] {
  return readCatalog(provider).map(({ id, name, reasoning, cost }) => ({
    id, name, reasoning, cost: { input: cost.input, output: cost.output },
  }));
}
