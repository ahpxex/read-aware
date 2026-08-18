import type { Api, Model } from "@earendil-works/pi-ai";
import { buildProviderRegistry, type KnownProviderId, type ProviderRegistry } from "./registry";
import type { ModelRole, ResolveModel } from "./roles";
import {
  CUSTOM_OPENAI_PROVIDER_ID,
  registerCustomOpenAIProvider,
  type CustomOpenAIApi,
} from "./custom-openai";

/**
 * LLM 账户：一行配置怎么认证（doc §8）。
 * BYOK（api-key）与 ReadAware 订阅（readaware，中继代理）已落地；
 * 目标形态还剩 `oauth`（第三方订阅）一种 kind。
 */
export interface ApiKeyAccount {
  kind: "api-key";
  provider: KnownProviderId;
  apiKey: string;
}

export interface CustomOpenAIAccount {
  kind: "api-key";
  provider: typeof CUSTOM_OPENAI_PROVIDER_ID;
  apiKey: string;
  baseUrl: string;
  api: CustomOpenAIApi;
  supportsThinking?: boolean;
  /** Undefined leaves the wire-level output limit to the upstream. */
  maxOutputTokens?: number;
}

/**
 * ReadAware 订阅：模型跑在中继的计量代理后面（relay `/v1/ai`，OpenAI 兼容），
 * 认证就是同步会话——所以它在实现上骑在 custom-openai 机制上，session 落在
 * apiKey 的槽位（OpenAI 兼容的 `Authorization: Bearer` 恰好就是 relay 的会话头）。
 */
export interface ReadAwareAccount {
  kind: "readaware";
  /** 中继代理基址，例如 `https://relay.readaware.app/v1/ai`。 */
  baseUrl: string;
  /** 同步会话 token —— 代理的 bearer 凭据。 */
  session: string;
}

export type LlmAccount = ApiKeyAccount | CustomOpenAIAccount | ReadAwareAccount;

export function isCustomOpenAIAccount(
  account: LlmAccount,
): account is CustomOpenAIAccount {
  return account.kind === "api-key" && account.provider === CUSTOM_OPENAI_PROVIDER_ID;
}

/** 账户随请求携带的凭据（readaware = 同步会话 token）——一样是秘密，一样要脱敏。 */
export function accountCredential(account: LlmAccount): string {
  return account.kind === "readaware" ? account.session : account.apiKey;
}

/** 遥测/展示用的 provider 标识；readaware 以自身为名，不冒充上游。 */
export function accountProviderId(account: LlmAccount): string {
  return account.kind === "readaware" ? "readaware" : account.provider;
}

/** 订阅目录与默认档：与 relay 的 aiModels 目录同步演进(apps/relay/src/ai-proxy.ts)。 */
export const READAWARE_MODEL_IDS = ["deepseek-v4-flash", "deepseek-v4-pro"] as const;
export const DEFAULT_READAWARE_MODEL = READAWARE_MODEL_IDS[0];

/** 两档模型的具体 id，由账户配置决定（Settings → AI 可覆盖）。 */
export interface RoleModels {
  smart: string;
  fast: string;
}

/**
 * 把「档位 → 具体模型」的解析收在一处。
 * 配置的 model id 不在 pi 的静态目录里时，克隆同 provider 的任一模型并覆盖 id
 * （目录滞后于 provider 上新是常态，不该挡住用户）。
 */
export function createModelResolver(
  account: LlmAccount,
  roles: RoleModels,
  sharedRegistry?: ProviderRegistry,
): ResolveModel {
  const registry = sharedRegistry ?? buildProviderRegistry();
  if (isCustomOpenAIAccount(account)) {
    registerCustomOpenAIProvider(registry, {
      baseUrl: account.baseUrl,
      api: account.api,
      modelIds: [roles.smart, roles.fast],
      supportsThinking: account.supportsThinking,
      maxOutputTokens: account.maxOutputTokens,
    });
  } else if (account.kind === "readaware") {
    // The relay proxy is OpenAI-compatible, so the subscription reuses the
    // custom provider wholesale. Thinking stays off at the wire level: the
    // upstream models decide their own reasoning; the proxy's catalog is the
    // authority on what resolves. Output caps live on the proxy, not here.
    registerCustomOpenAIProvider(registry, {
      baseUrl: account.baseUrl,
      api: "openai-completions",
      modelIds: [...new Set([roles.smart, roles.fast, ...READAWARE_MODEL_IDS])],
      supportsThinking: false,
    });
  }
  const providerId =
    account.kind === "readaware" ? CUSTOM_OPENAI_PROVIDER_ID : account.provider;
  const cache = new Map<ModelRole, Model<Api>>();
  return (role) => {
    const cached = cache.get(role);
    if (cached) return cached;
    const id = roles[role];
    let model = registry.getModel(providerId, id);
    if (!model) {
      const fallback = registry.getModels(providerId)[0];
      if (!fallback) throw new Error(`no models registered for provider ${providerId}`);
      model = { ...fallback, id };
    }
    cache.set(role, model);
    return model;
  };
}
