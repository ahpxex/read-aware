import type { AgentToolResult } from "@earendil-works/pi-agent-core";

/**
 * Extract the model-visible text from a tool result for the local execution
 * trace. Structured `details` stay private to their purpose-built UI (cards,
 * interaction prompts); image payloads are deliberately not copied into chat
 * persistence.
 */
export function toolResultText(result: AgentToolResult<unknown>): string | undefined {
  const text = result.content
    .filter((item): item is Extract<(typeof result.content)[number], { type: "text" }> =>
      item.type === "text",
    )
    .map((item) => item.text)
    .filter((item) => item.trim().length > 0)
    .join("\n");
  return text || undefined;
}
