import { describe, expect, test } from "bun:test";
import {
  OLLAMA_CLOUD_BASE_URL,
  OLLAMA_CLOUD_MODELS,
  OLLAMA_CLOUD_PROVIDER_ID,
} from "./ollama-cloud";
import { buildProviderRegistry } from "./registry";

describe("Ollama Cloud provider", () => {
  test("registers its curated models under its own provider id", () => {
    const registry = buildProviderRegistry();
    expect(registry.getModels(OLLAMA_CLOUD_PROVIDER_ID).map((model) => model.id)).toEqual([
      ...OLLAMA_CLOUD_MODELS,
    ]);
    expect(registry.getModel(OLLAMA_CLOUD_PROVIDER_ID, OLLAMA_CLOUD_MODELS[0])).toMatchObject({
      provider: OLLAMA_CLOUD_PROVIDER_ID,
      baseUrl: OLLAMA_CLOUD_BASE_URL,
      api: "openai-completions",
      reasoning: true,
      maxTokens: 16_384,
    });
  });
});
