/**
 * Bridges plugin-registered tools into the agent runtime's AgentTool shape
 * (docs/plugin-system.md §8): namespaced `plugin_<id>_<name>`, provenance in
 * the description so the model knows the source, JSON results. Wired into
 * RuntimeDeps.extraTools; the registry snapshot is taken per agent build.
 */
import type { AgentTool } from "@read-aware/agent";
import type { RegisteredTool } from "../lib/plugin-types";
import { getRegisteredPluginTools } from "../state/plugin-store";

function sanitize(part: string): string {
  return part.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Exposed for the chat UI too — one place defines the wire name. */
export function pluginToolName(tool: RegisteredTool): string {
  return `plugin_${sanitize(tool.pluginId)}_${sanitize(tool.name)}`;
}

const EMPTY_PARAMETERS = { type: "object", properties: {}, additionalProperties: false };

export function getPluginAgentTools(): AgentTool[] {
  return getRegisteredPluginTools().map((tool) => ({
    name: pluginToolName(tool),
    label: tool.label ?? `${tool.pluginName} · ${tool.name}`,
    // Provenance stays visible to the model; plugins describe only behavior.
    description: `[Plugin: ${tool.pluginName}] ${tool.description}`,
    // pi passes the schema through to the provider without TypeBox runtime
    // validation, so plain JSON Schema is the honest input type here.
    parameters: (tool.parameters ?? EMPTY_PARAMETERS) as AgentTool["parameters"],
    execute: async (_toolCallId, params) => {
      const result = await tool.execute((params ?? {}) as Record<string, unknown>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result ?? null) }],
        details: undefined,
      };
    },
  }));
}
