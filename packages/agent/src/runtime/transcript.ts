/**
 * pi carries the system prompt and tool declarations inside the transcript:
 * the leading system message holds the base prompt and the tools declared so
 * far, and later system messages declare tool changes in place, so a refreshed
 * loadout extends the cached prefix instead of replacing it.
 *
 * The thread owns one complete prompt per turn (its section order is the cache
 * layout, see buildSystemPrompt), so the prompt always lives in the leading
 * system message. These helpers keep that invariant whenever the thread rewrites
 * the transcript.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  getCurrentSystemMessage,
  getCurrentSystemPrompt,
  getCurrentTools,
  normalizeContext,
  type Context,
  type Message,
  type SystemMessage,
  type Tool,
} from "@earendil-works/pi-ai";

function isSystemMessage(message: AgentMessage): message is SystemMessage {
  return message.role === "system";
}

/** Put `prompt` in the leading system message, keeping the tools it declares. */
export function withSystemPrompt(messages: AgentMessage[], prompt: string): AgentMessage[] {
  const [first, ...rest] = messages;
  if (first && isSystemMessage(first)) return [{ ...first, content: prompt }, ...rest];
  return [{ role: "system", content: prompt, timestamp: Date.now() }, ...messages];
}

/**
 * Replace the conversation and keep the system state: every system message of
 * `current` folds into one leading message holding the prompt and the tools
 * the model has been told about.
 */
export function withConversation(current: AgentMessage[], conversation: AgentMessage[]): AgentMessage[] {
  const head = getCurrentSystemMessage(current);
  return head ? [head, ...conversation] : conversation;
}

/** Whether the transcript holds anything besides the prompt and tool declarations. */
export function hasConversation(messages: AgentMessage[]): boolean {
  return messages.some((message) => !isSystemMessage(message));
}

/** What one request shows the model: the replayed prompt, the tools it may call, and the conversation. */
export interface ModelRequestView {
  systemPrompt: string;
  tools: Tool[];
  messages: Message[];
}

/**
 * Read a request in the shape the model experiences it. Accepts both a raw
 * `Context` (prompt and tools as fields) and a transcript context (prompt and
 * tools as system messages).
 */
export function modelRequestView(context: Context): ModelRequestView {
  const { messages } = normalizeContext(context);
  return {
    systemPrompt: getCurrentSystemPrompt(messages),
    tools: getCurrentTools(messages),
    messages: messages.filter((message) => message.role !== "system"),
  };
}
