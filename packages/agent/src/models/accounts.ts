import type { Api, Model } from "@earendil-works/pi-ai";
import { buildProviderRegistry, type KnownProviderId, type ProviderRegistry } from "./registry";
import type { ModelRole, ResolveModel } from "./roles";

/**
 * LLM 账户：一行配置怎么认证（doc §8）。
 * 目标形态还有 `oauth`（订阅）与 `readaware`（自家订阅 + proxy）两种 kind，
 * 现在只落地 BYOK。
 */
export interface ApiKeyAccount {
  kind: "api-key";
  provider: KnownProviderId;
  apiKey: string;
  baseUrl?: string;
}

export type LlmAccount = ApiKeyAccount;

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
  const cache = new Map<ModelRole, Model<Api>>();
  return (role) => {
    const cached = cache.get(role);
    if (cached) return cached;
    const id = roles[role];
    let model = registry.getModel(account.provider, id);
    if (!model) {
      const fallback = registry.getModels(account.provider)[0];
      if (!fallback) throw new Error(`no models registered for provider ${account.provider}`);
      model = { ...fallback, id };
    }
    if (account.baseUrl) model = { ...model, baseUrl: account.baseUrl };
    cache.set(role, model);
    return model;
  };
}
