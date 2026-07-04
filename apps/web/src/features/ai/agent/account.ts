/**
 * Settings 的 AIConfig → agent 包的账户与档位模型，唯一的一份映射。
 * AgentRuntime 装配与 Settings 的连接测试共用，保证两边看到同一个账户形态
 * （custom = OpenAI 兼容端点 → openai provider + baseUrl）。
 */
import type { LlmAccount, RoleModels } from "@read-aware/agent";
import { DEFAULT_MODELS, type AIConfig } from "../lib/ai-config";

/** fast 档位的默认模型；Settings 里的独立选项属于后续产品细节。 */
const FAST_DEFAULTS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  openrouter: "openai/gpt-4o-mini",
  zai: "glm-5.2",
  "zai-coding-cn": "glm-5.2",
};

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
  const models: RoleModels = {
    smart,
    fast: config.provider === "custom" ? smart : (FAST_DEFAULTS[config.provider] ?? smart),
  };
  return { account, models };
}
