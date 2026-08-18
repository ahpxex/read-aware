/**
 * Settings 的 AIConfig → agent 包的账户与档位模型，唯一的一份映射。
 * AgentRuntime 装配与 Settings 的连接测试共用，保证两边看到同一个账户形态
 * Custom 使用 agent 包里的独立双协议 provider，不再借用 OpenAI 目录模型。
 */
import {
  CUSTOM_OPENAI_PROVIDER_ID,
  LEGACY_CUSTOM_OPENAI_API,
  normalizeCustomOpenAIBaseUrl,
  type LlmAccount,
  type RoleModels,
  type RoleThinking,
} from "@read-aware/agent";
import { getSecret } from "../../../platform/secret-store";
import { relayBaseUrl } from "../../../platform/sync/sync-scheduler";
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
    config.provider === "readaware"
      ? {
          // The subscription authenticates with the sync session — no key of
          // its own. Signed out, the session is "" and the relay answers 401,
          // which the settings panel pre-empts with its "connect first" state.
          kind: "readaware",
          baseUrl: `${relayBaseUrl()}/v1/ai`,
          session: getSecret("sync.session"),
        }
      : config.provider === "custom"
        ? {
            kind: "api-key",
            provider: CUSTOM_OPENAI_PROVIDER_ID,
            apiKey: config.apiKey,
            baseUrl: normalizeCustomOpenAIBaseUrl(config.customBaseUrl ?? ""),
            // Direct callers may still hand us the pre-migration shape. Stored
            // configs resolve this field before reaching accountFromConfig.
            api: config.customApi ?? LEGACY_CUSTOM_OPENAI_API,
            supportsThinking: Boolean(config.customSupportsThinking),
            maxOutputTokens: config.customMaxOutputTokens,
          }
        : { kind: "api-key", provider: config.provider, apiKey: config.apiKey };

  const smart = config.model || DEFAULT_MODELS[config.provider];
  // The simple setup path uses one model for both roles. A distinct Fast model
  // only exists when the user explicitly chooses that advanced override.
  const hasSeparateFastModel = Boolean(
    config.fastModel && config.fastModel !== smart,
  );
  const fast = hasSeparateFastModel ? config.fastModel! : smart;
  const smartThinking = config.thinkingLevel ?? DEFAULT_THINKING_LEVEL;

  const models: RoleModels = { smart, fast };
  const thinking: RoleThinking = {
    smart: smartThinking,
    fast: hasSeparateFastModel
      ? config.fastThinkingLevel ?? DEFAULT_THINKING_LEVEL
      : smartThinking,
  };
  return { account, models, thinking };
}
