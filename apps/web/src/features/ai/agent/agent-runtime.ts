/**
 * 产品里的 AgentRuntime 单例：由 Settings → AI 的 BYOK 配置装配
 * （账户映射见 ./account）。配置变化时重建（线程会重新水化，转录在 store 里，无损）。
 */
import { createAgentRuntime, type AgentRuntime } from "@read-aware/agent";
import { getAIConfig } from "../lib/ai-config";
import { accountFromConfig } from "./account";
import { buildRuntimeDeps } from "./ports";

let cached: { key: string; runtime: AgentRuntime } | null = null;

export function getAgentRuntime(): AgentRuntime | null {
  const config = getAIConfig();
  if (!config?.apiKey) return null;

  const { account, models } = accountFromConfig(config);

  const key = JSON.stringify([account, models]);
  if (cached?.key !== key) {
    cached = { key, runtime: createAgentRuntime({ deps: buildRuntimeDeps(), account, models }) };
  }
  return cached.runtime;
}
