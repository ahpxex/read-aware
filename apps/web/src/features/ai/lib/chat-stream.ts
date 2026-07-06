import type { ChatAssistantPart, ChatStreamChunk } from "./chat-types";

/**
 * Pure assembly of the assistant turn: folds transport chunks into the ordered
 * part timeline the UI renders. Immutable — every call returns a fresh array
 * (with the touched part copied) so it can back a React state update directly.
 */
export function appendStreamChunk(
  parts: ChatAssistantPart[],
  chunk: ChatStreamChunk,
): ChatAssistantPart[] {
  switch (chunk.type) {
    case "text":
    case "thinking": {
      const last = parts[parts.length - 1];
      if (last && last.type === chunk.type) {
        return [...parts.slice(0, -1), { ...last, text: last.text + chunk.text }];
      }
      return [...parts, { type: chunk.type, text: chunk.text }];
    }
    case "tool": {
      if (chunk.phase === "start") {
        return [
          ...parts,
          { type: "tool", id: chunk.id, tool: chunk.tool, detail: chunk.detail, state: "running" },
        ];
      }
      return parts.map((part) =>
        part.type === "tool" && part.id === chunk.id && part.state === "running"
          ? { ...part, state: chunk.isError ? "error" : "done" }
          : part,
      );
    }
    default:
      // `status` (and any future chunk kinds) don't shape the timeline.
      return parts;
  }
}

/**
 * Settle a timeline for persistence: tools still "running" (stopped or failed
 * mid-call) settle to "done" so no spinner is ever stored, and empty text runs
 * are dropped.
 */
export function finalizeParts(parts: ChatAssistantPart[]): ChatAssistantPart[] {
  return parts
    .filter((part) => part.type === "tool" || part.text.trim().length > 0)
    .map((part) =>
      part.type === "tool" && part.state === "running" ? { ...part, state: "done" } : part,
    );
}

/**
 * The plain-text reply projection: visible prose only (no thinking, no tool
 * trace), segments separated by a blank line. This is what `ChatMessage.content`
 * stores and what the agent's conversation history reads back.
 */
export function partsText(parts: ChatAssistantPart[]): string {
  return parts
    .filter((part): part is Extract<ChatAssistantPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

const DETAIL_MAX_CHARS = 80;

function truncate(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > DETAIL_MAX_CHARS ? `${clean.slice(0, DETAIL_MAX_CHARS - 1)}…` : clean;
}

/**
 * Distill a tool call's raw arguments into the one short string worth showing
 * next to its label — the search query, the sentence being remembered, the
 * chapter number. Anything opaque (book ids, flags) yields nothing.
 */
export function toolStepDetail(tool: string, args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  if (typeof record.query === "string" && record.query.trim()) return truncate(record.query);
  if (tool === "remember" && typeof record.content === "string" && record.content.trim()) {
    return truncate(record.content);
  }
  if (tool === "read_chapter" && typeof record.chapterIndex === "number") {
    const part = typeof record.part === "number" && record.part > 0 ? ` · ${record.part + 1}` : "";
    return `#${record.chapterIndex}${part}`;
  }
  return undefined;
}
