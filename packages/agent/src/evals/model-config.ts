import { readPiCliKey } from "../dev-key";
import type { LlmAccount } from "../models/accounts";
import { isCustomOpenAIApi } from "../models/custom-openai";
import {
  KNOWN_PROVIDERS,
  type KnownProviderId,
  type ProviderRegistry,
} from "../models/registry";

const envKeys: Record<KnownProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  zai: "ZAI_API_KEY",
  "zai-coding-cn": "ZAI_CODING_CN_API_KEY",
  google: "GOOGLE_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  xai: "XAI_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  moonshotai: "MOONSHOTAI_API_KEY",
};

export interface ResolvedEvalModel {
  account: LlmAccount;
  modelId: string;
}

export function resolveEvalModel(
  registry: ProviderRegistry,
  providerInput: string,
  requestedModel?: string,
): ResolvedEvalModel {
  const providerArg = providerInput.trim();
  if (providerArg === "custom" || providerArg === "custom-openai") {
    const baseUrl = process.env.READAWARE_EVAL_BASE_URL?.trim() ?? "";
    const apiKey = process.env.READAWARE_EVAL_API_KEY?.trim() ?? "";
    const modelId = requestedModel?.trim() ?? process.env.READAWARE_EVAL_MODEL?.trim() ?? "";
    const rawApi = process.env.READAWARE_EVAL_API ?? "openai-completions";
    if (!baseUrl || !apiKey || !modelId || !isCustomOpenAIApi(rawApi)) {
      throw new Error(
        "custom eval requires READAWARE_EVAL_BASE_URL, READAWARE_EVAL_API_KEY, a model, and a valid READAWARE_EVAL_API",
      );
    }
    return {
      account: {
        kind: "api-key",
        provider: "custom-openai",
        apiKey,
        baseUrl,
        api: rawApi,
        supportsThinking: process.env.READAWARE_EVAL_THINKING !== "off",
      },
      modelId,
    };
  }

  if (!KNOWN_PROVIDERS.includes(providerArg as KnownProviderId)) {
    throw new Error(`unknown provider ${JSON.stringify(providerArg)}`);
  }
  const provider = providerArg as KnownProviderId;
  const apiKey = process.env[envKeys[provider]] ?? readPiCliKey(provider) ?? "";
  if (!apiKey) {
    throw new Error(`no API key: set ${envKeys[provider]} or configure pi CLI auth`);
  }
  const catalog = registry.getModels(provider);
  const modelId = requestedModel?.trim() || catalog.find((model) => model.reasoning)?.id || catalog[0]?.id;
  if (!modelId) throw new Error(`provider ${provider} has no registered model`);
  return { account: { kind: "api-key", provider, apiKey }, modelId };
}
