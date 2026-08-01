/**
 * Settings 的 AIConfig → agent 包的账户与档位模型，唯一的一份映射。
 * AgentRuntime 装配与 Settings 的连接测试共用，保证两边看到同一个账户形态
 * （custom = OpenAI 兼容端点 → openai provider + baseUrl）。
 */
import type { LlmAccount, RoleModels, RoleThinking } from "@read-aware/agent";
import {
  DEFAULT_MODELS,
  DEFAULT_THINKING_LEVEL,
  type AIConfig,
} from "../lib/ai-config";

export function accountFromConfig(config: AIConfig): {
  account: LlmAccount;
  models: RoleModels;
  thinking: RoleThinking;
} {
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
  // The simple setup path uses one model for both roles. A distinct Fast model
  // only exists when the user explicitly chooses that advanced override.
  const fast = config.fastModel || smart;

  const models: RoleModels = { smart, fast };
  const thinking: RoleThinking = {
    smart: config.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
    fast: config.fastThinkingLevel ?? DEFAULT_THINKING_LEVEL,
  };
  return { account, models, thinking };
}
