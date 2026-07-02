/**
 * 产品里的 AgentRuntime 单例：由 Settings → AI 的 BYOK 配置装配
 * （custom = OpenAI 兼容端点 → openai provider + baseUrl）。
 * 配置变化时重建（线程会重新水化，转录在 store 里，无损）。
 */
import {
  createAgentRuntime,
  type AgentRuntime,
  type LlmAccount,
  type RoleModels,
} from "@read-aware/agent";
import { DEFAULT_MODELS, getAIConfig } from "../lib/ai-config";
import { buildRuntimeDeps } from "./ports";

/** fast 档位的默认模型；Settings 里的独立选项属于后续产品细节。 */
const FAST_DEFAULTS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  openrouter: "openai/gpt-4o-mini",
  zai: "glm-5.2",
  "zai-coding-cn": "glm-5.2",
};

let cached: { key: string; runtime: AgentRuntime } | null = null;

export function getAgentRuntime(): AgentRuntime | null {
  const config = getAIConfig();
  if (!config?.apiKey) return null;

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

  const key = JSON.stringify([account, models]);
  if (cached?.key !== key) {
    cached = { key, runtime: createAgentRuntime({ deps: buildRuntimeDeps(), account, models }) };
  }
  return cached.runtime;
}
