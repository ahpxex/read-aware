import { getDefaultStore } from "jotai";
import { AppError } from "@read-aware/core";
import { requestUserInteraction, threadScopeKey, type AgentTool, type ThreadScope, type UserInteractionPort } from "@read-aware/agent";
import type { RegisteredTool } from "../lib/plugin-types";
import { actionEnabled } from "../lib/plugin-action-state";
import { contributionText } from "../lib/plugin-i18n";
import { getRegisteredPluginTools, pluginToolsAtom } from "../state/plugin-store";
import { pluginCallbackOwner } from "./plugin-callback-wire";

/** Freeze exactly the JSON shown to the user, before any plugin callback runs. */
function argumentsSnapshot(raw: unknown): { json: string; params: Record<string, unknown> } {
  try {
    const value = raw ?? {};
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected object");
    const json = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === "undefined" || typeof item === "function" || typeof item === "symbol"
        || typeof item === "bigint" || typeof item === "number" && !Number.isFinite(item)) throw new Error("Non-JSON input");
      return item;
    }, 2);
    if (json.length > 16_384) throw new AppError("plugin/payload-too-large", "Approval arguments exceed 16384 characters");
    return { json, params: JSON.parse(json) as Record<string, unknown> };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("plugin/invalid-input", "Tool approval requires bounded JSON arguments");
  }
}

export async function confirmPluginTool(input: {
  tool: RegisteredTool; scope: ThreadScope; interactions?: UserInteractionPort;
  toolCallId: string; params: unknown; signal?: AbortSignal;
  onUpdate?: Parameters<AgentTool["execute"]>[3];
}) {
  const { tool } = input;
  if (!input.interactions) throw new AppError("ui/unavailable", "Plugin tool confirmation is not attached");
  const { json, params } = argumentsSnapshot(input.params);
  const retired = new AbortController();
  const owner = pluginCallbackOwner(tool.execute);
  const signal = AbortSignal.any([retired.signal, AbortSignal.timeout(300_000),
    ...(input.signal ? [input.signal] : []), ...(owner ? [owner] : [])]);
  const check = () => {
    const current = getRegisteredPluginTools().find(item => item.key === tool.key && item.execute === tool.execute);
    if (!current) retired.abort(new AppError("plugin/unavailable", "Tool registration retired"));
    else if (!actionEnabled(current)) retired.abort(new AppError("plugin/action-disabled", "Tool no longer available"));
  };
  const stop = getDefaultStore().sub(pluginToolsAtom, check);
  try {
    check(); signal.throwIfAborted();
    const label = tool.label ? contributionText(tool.label) : tool.name;
    const subject = `${tool.pluginName} (${tool.pluginId}) / ${label}\n${tool.description}\n\n${json}`;
    if (subject.length > 24_576) throw new AppError("plugin/payload-too-large", "Tool confirmation exceeds display budget");
    const response = await requestUserInteraction({ deps: { interactions: input.interactions },
      toolCallId: input.toolCallId, threadKey: threadScopeKey(input.scope), signal, onUpdate: input.onUpdate,
      request: { kind: "permission", action: "plugin-tool", subject } });
    check(); signal.throwIfAborted();
    return { ...response, params, approved: !response.answer.cancelled && response.answer.optionId === "approve" };
  } finally { stop(); }
}
