/**
 * Settings 的 AIConfig → agent 包的账户与档位模型，唯一的一份映射。
 * AgentRuntime 装配与 Settings 的连接测试共用，保证两边看到同一个账户形态
 * （custom = OpenAI 兼容端点 → openai provider + baseUrl）。
 */
import type { LlmAccount, RoleModels } from "@read-aware/agent";
import { DEFAULT_MODELS, FAST_DEFAULT_MODELS, type AIConfig } from "../lib/ai-config";

export function accountFromConfig(config: AIConfig): { account: LlmAccount; models: RoleModels } {
  const account: LlmAccount =
    config.provider === "custom"
      ? {
          kind: "api-key",
          provider: "openai",
          apiKey: config.apiKey,
          baseUrl: config.customBaseUrl,
        }
      : { kind: "api-key", provider: config.provider, apiKey: config.apiKey };

  const smart = config.model || DEFAULT_MODELS[config.provider];
  // A custom (single) endpoint has no second catalog to draw a cheaper model
  // from, so fast falls back to smart. Everywhere else: the user's Fast choice,
  // then the per-provider fast default, then smart.
  const fast =
    config.provider === "custom"
      ? config.fastModel || smart
      : config.fastModel || FAST_DEFAULT_MODELS[config.provider] || smart;

  const models: RoleModels = { smart, fast };
  return { account, models };
}
