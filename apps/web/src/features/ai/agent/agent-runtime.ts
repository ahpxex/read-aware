/**
 * 产品里的 AgentRuntime 单例：由 Settings → AI 的 BYOK 配置装配
 * （账户映射见 ./account）。配置变化时重建（线程会重新水化，转录在 store 里，无损）。
 */
import {
  createAgentRuntime,
  type AgentRuntime,
  type ThreadScope,
  threadScopeKey,
} from "@read-aware/agent";
import type { Id } from "@read-aware/core";
import { getDefaultStore } from "jotai";
import { appHttpFetch } from "../../../platform/http-client";
import {
  pluginAgentContextProvidersAtom,
  pluginAgentRetrievalProvidersAtom,
  pluginMemoryCandidateProvidersAtom,
  pluginToolsAtom,
} from "../../plugins/state/plugin-store";
import { getAIConfig, type OpenRouterRoutingConfig } from "../lib/ai-config";
import { accountFromConfig } from "./account";
import { buildRuntimeDeps } from "./ports";
import { clearStoredConversationInsights } from "./ports/conversation-port";

let cached: { key: string; runtime: AgentRuntime } | null = null;

// 插件工具集变化（启停/安装）时，让所有线程下一轮以新工具快照重建 Agent。
getDefaultStore().sub(pluginToolsAtom, () => {
  cached?.runtime.invalidateAgents();
});
getDefaultStore().sub(pluginAgentRetrievalProvidersAtom, () => {
  cached?.runtime.invalidateAgents();
});
getDefaultStore().sub(pluginAgentContextProvidersAtom, () => {
  cached?.runtime.invalidateAgents();
});
getDefaultStore().sub(pluginMemoryCandidateProvidersAtom, () => {
  cached?.runtime.invalidateAgents();
});

/** 用户配置的 OpenRouter 上游路由 → pi-ai 的 compat.openRouterRouting。 */
function routingTransform(routing: OpenRouterRoutingConfig | undefined) {
  if (!routing) return undefined;
  const preference = {
    ...(routing.order?.length ? { order: routing.order } : {}),
    ...(routing.sort ? { sort: routing.sort } : {}),
    allow_fallbacks: routing.allowFallbacks !== false,
  };
  return <T extends { provider: string; compat?: object }>(model: T): T =>
    model.provider === "openrouter"
      ? { ...model, compat: { ...model.compat, openRouterRouting: preference } }
      : model;
}

export function getAgentRuntime(): AgentRuntime | null {
  const config = getAIConfig();
  if (!config?.apiKey) return null;

  const { account, models, thinking } = accountFromConfig(config);
  const routing = config.provider === "openrouter" ? config.openRouterRouting : undefined;

  const key = JSON.stringify([account, models, thinking, routing ?? null]);
  if (cached?.key !== key) {
    cached = {
      key,
      runtime: createAgentRuntime({
        deps: buildRuntimeDeps(),
        account,
        models,
        thinking,
        fetch: appHttpFetch,
        transformModel: routingTransform(routing),
      }),
    };
  }
  return cached.runtime;
}

/** Clear hidden pi state when the corresponding persisted conversation is removed. */
export async function discardAgentThread(kind: "book" | "global", id: string): Promise<void> {
  const scope: ThreadScope =
    kind === "book"
      ? { kind: "book", bookId: id as Id }
      : { kind: "global", threadId: id };
  if (cached) {
    await cached.runtime.discardThread(scope);
  } else {
    clearStoredConversationInsights(threadScopeKey(scope));
  }
}
