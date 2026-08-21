import { readPiCliKey } from "../dev-key";
import type { LlmAccount } from "../models/accounts";
import { accountCredential, accountProviderId, createModelResolver } from "../models/accounts";
import { createCompleteFn } from "../models/complete";
import { isCustomOpenAIApi } from "../models/custom-openai";
import {
  KNOWN_PROVIDERS,
  buildProviderRegistry,
  type KnownProviderId,
  type ProviderRegistry,
} from "../models/registry";
import { PiCliCredentialStore } from "./pi-cli-credentials";

/**
 * eval/dev 链路的 registry：挂上 pi CLI 的凭证仓，OAuth 订阅 provider
 * （openai-codex 等）由 pi-ai 自动解析并刷新 token；api-key provider 的
 * 显式 apiKey override 优先级更高，行为不变。
 */
export function evalProviderRegistry(): ProviderRegistry {
  return buildProviderRegistry({ credentials: new PiCliCredentialStore() });
}

/** 走 pi-ai 凭证仓解析（无 auth.apiKey 声明）的订阅式 provider。 */
const OAUTH_PROVIDERS = new Set<KnownProviderId>(["openai-codex"]);

const envKeys: Record<KnownProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  "openai-codex": "OPENAI_CODEX_ACCESS_TOKEN",
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

/**
 * provider 未指定模型时的 eval 缺省。OpenRouter 目录三百多个模型，
 * "第一个 reasoning 模型"是碰运气——显式钉住与 DeepSeek 官方档相同的
 * 模型（OpenRouter slug 形态）。
 */
const EVAL_DEFAULT_MODELS: Partial<Record<KnownProviderId, string>> = {
  openrouter: "deepseek/deepseek-v4-flash",
  // Coding Plan 包月端点：catalog 滞后（此刻只收录到 5.2），id 会原样透传，
  // 端点实测认识 glm-5.3——不钉住会碰运气落到目录第一个 reasoning 模型。
  "zai-coding-cn": "glm-5.3",
  // Codex 订阅（pi CLI oauth）：不钉住会落到目录第一个 reasoning 模型。
  "openai-codex": "gpt-5.6-luna",
};

/**
 * eval 侧的 OpenRouter 上游路由：优先 CoreWeave（fp8 端点，快且稳定），
 * 不可用时允许回退——eval 不该因单一上游抖动而全挂。只影响 eval/开发
 * 链路；产品用户的 OpenRouter 路由归他们自己的账户偏好。
 */
const OPENROUTER_EVAL_ROUTING = {
  order: ["coreweave"],
  allow_fallbacks: true,
} as const;

/** 给 eval 解析出的模型注入路由偏好（仅 openrouter；其余原样返回）。 */
export function applyEvalRouting<T extends { provider: string; compat?: object }>(model: T): T {
  if (model.provider !== "openrouter") return model;
  return {
    ...model,
    compat: { ...model.compat, openRouterRouting: OPENROUTER_EVAL_ROUTING },
  };
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
  if (!apiKey && !OAUTH_PROVIDERS.has(provider)) {
    throw new Error(`no API key: set ${envKeys[provider]} or configure pi CLI auth`);
  }
  if (OAUTH_PROVIDERS.has(provider) && !apiKey) {
    throw new Error(
      `provider ${provider} needs a pi CLI oauth login (run \`pi\` and sign in) — no entry found in ~/.pi/agent/auth.json`,
    );
  }
  const catalog = registry.getModels(provider);
  const modelId =
    requestedModel?.trim() ||
    EVAL_DEFAULT_MODELS[provider] ||
    catalog.find((model) => model.reasoning)?.id ||
    catalog[0]?.id;
  if (!modelId) throw new Error(`provider ${provider} has no registered model`);
  return { account: { kind: "api-key", provider, apiKey }, modelId };
}

export interface ResolvedJudgeCompletion {
  complete: (prompt: string) => Promise<string>;
  secret: string;
  metadata: { provider: string; model: string };
}

/** judge 用的单次非流式补全：与 eval 变体同一套 provider 解析。 */
export function resolveJudgeCompletion(
  providerInput: string,
  requestedModel?: string,
): ResolvedJudgeCompletion {
  const registry = evalProviderRegistry();
  const resolved = resolveEvalModel(registry, providerInput, requestedModel);
  const completeFn = createCompleteFn(registry, resolved.account, "off");
  const model = applyEvalRouting(
    createModelResolver(
      resolved.account,
      { smart: resolved.modelId, fast: resolved.modelId },
      registry,
    )("smart"),
  );
  return {
    complete: async (prompt) => {
      const message = await completeFn(model, {
        messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
      });
      return message.content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("");
    },
    secret: accountCredential(resolved.account),
    metadata: { provider: accountProviderId(resolved.account), model: resolved.modelId },
  };
}
