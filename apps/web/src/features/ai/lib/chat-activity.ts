import type { ChatAssistantPart, ChatThinkingPart, ChatToolPart } from "./chat-types";

export interface ChatActivityPart {
  type: "activity";
  parts: (ChatToolPart | ChatThinkingPart)[];
  /**
   * Answer prose already follows the group's position. A later tool round must
   * not unfold the group above text the reader may be reading.
   */
  precedesProse: boolean;
}

/**
 * Presentation only: collect a turn's tools and reasoning in one disclosure.
 * Keep prose, references and interaction prompts in their original order and
 * outside the disclosure, including prompts waiting on a running tool.
 * Persisted parts and the agent's timeline are never changed.
 */
export function groupChatActivity(parts: ChatAssistantPart[]): (ChatAssistantPart | ChatActivityPart)[] {
  if (!parts.some((part) => part.type === "tool")) return parts;
  const activity: ChatActivityPart = { type: "activity", parts: [], precedesProse: false };
  const visible: (ChatAssistantPart | ChatActivityPart)[] = [];
  for (const part of parts) {
    if (part.type === "tool" || part.type === "thinking") {
      if (activity.parts.length === 0) visible.push(activity);
      activity.parts.push(part);
    } else {
      if (part.type === "text" && activity.parts.length > 0 && part.text.trim()) activity.precedesProse = true;
      visible.push(part);
    }
  }
  return visible;
}
