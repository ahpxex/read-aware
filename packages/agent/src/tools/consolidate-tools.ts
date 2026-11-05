import type { AgentTool } from "@earendil-works/pi-agent-core";
import { validateToolArguments, type JsonObject } from "@earendil-works/pi-ai";
import { AppError } from "@read-aware/core";
import { TOOL_FAMILIES, rewriteToolReferences } from "./tool-families";
import { setToolAvailability, toolAvailability } from "./tool-availability";
import { lit, obj, union } from "@earendil-works/pi-schema";

/** Compose the existing guarded domain handlers into typed, resource-specific
 * tools. No generic tool-name dispatcher, legacy aliases or bypass of guards.
 * Unavailable operations are removed from the request schema, then the selected
 * handler rechecks availability at execution time. */
export function consolidateHostTools(all: AgentTool[]): { all: AgentTool[]; enabled: AgentTool[] } {
  const consumed = new Set<string>(TOOL_FAMILIES.flatMap((f) => Object.values(f.members)));
  const result = all.filter((tool) => !consumed.has(tool.name));
  for (const family of TOOL_FAMILIES) {
    const members = Object.entries(family.members).flatMap(([operation, name]) => {
      const tool = all.find((tool) => tool.name === name);
      return tool ? [{ operation, tool }] : [];
    });
    if (!members.length) continue;
    const active = members.filter(({ tool }) => toolAvailability(tool)?.state !== "unavailable");
    const selected = active.length ? active : members;
    const grouped: AgentTool = {
      name: family.name,
      label: family.label,
      description: family.description,
      // A family containing mutations must preserve sequential execution even
      // if a read operation happens to be selected this time.
      ...(("sequential" in family && family.sequential) ||
      members.some(({ tool }) => tool.executionMode === "sequential")
        ? { executionMode: "sequential" as const }
        : {}),
      parameters: obj({
        request: union(
          selected.map(({ operation, tool }) => {
            const schema = tool.parameters as {
              type?: unknown;
              properties?: Record<string, object>;
              required?: string[];
            };
            if (schema.type !== "object" || !schema.properties || "operation" in schema.properties) {
              throw new Error(`Cannot group non-object or conflicting parameters: ${tool.name}`);
            }
            return {
              ...schema,
              properties: { operation: lit(operation), ...schema.properties },
              required: ["operation", ...(schema.required ?? [])],
              additionalProperties: false,
              description: rewriteToolReferences(tool.description),
            };
          }),
        ),
      }),
      execute: async (id, input, signal, onUpdate) => {
        signal?.throwIfAborted();
        if (!input || typeof input !== "object" || Array.isArray(input))
          throw new AppError("ui/invalid-target", "Expected a structured request");
        const { request } = validateToolArguments(grouped, {
          type: "toolCall",
          id,
          name: grouped.name,
          arguments: input as JsonObject,
        }) as { request: { operation: string; [key: string]: unknown } };
        const { operation, ...args } = request;
        const member = active.find((item) => item.operation === operation);
        if (!member) throw new AppError("ui/unavailable", "This operation is not available in the current scope");
        return member.tool.execute(id, args, signal, onUpdate);
      },
    };
    setToolAvailability(
      grouped,
      active.length
        ? { state: active.some(({ tool }) => toolAvailability(tool)?.state === "unknown") ? "unknown" : "available" }
        : {
            state: "unavailable",
            reason: members.map(({ operation, tool }) => `${operation}: ${toolAvailability(tool)?.reason}`).join("; "),
          },
    );
    result.push(grouped);
  }
  for (const tool of result) {
    tool.description = rewriteToolReferences(tool.description);
    tool.parameters = rewriteSchemaDescriptions(tool.parameters);
  }
  return { all: result, enabled: result.filter((tool) => toolAvailability(tool)?.state !== "unavailable") };
}

/** Only schema metadata is rewritten; runtime book/user content is never touched. */
function rewriteSchemaDescriptions<T>(value: T): T {
  if (Array.isArray(value)) return value.map(rewriteSchemaDescriptions) as T;
  if (!value || typeof value !== "object") return value;
  const copy = { ...value } as Record<string, unknown>;
  for (const [key, child] of Object.entries(copy))
    copy[key] =
      key === "description" && typeof child === "string"
        ? rewriteToolReferences(child)
        : rewriteSchemaDescriptions(child);
  return copy as T;
}
