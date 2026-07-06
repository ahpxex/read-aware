/**
 * transformContext 的上下文瘦身（windowByTurns 之后接在同一条链上）：
 * 已结束轮次里的大工具结果（整章正文、全书检索命中）对后续往返几乎没有
 * 边际价值，却在每次请求里原样重传。把最后一个用户消息*之前*的超长
 * toolResult 折叠成短存根 —— 当前轮内的工具结果永远完整保留，所以一轮
 * 多次往返之间前缀稳定，不破坏 provider 的 prompt cache。
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";

const KEEP_CHARS = 600;

interface ToolResultLike {
  role?: string;
  toolName?: string;
  content?: Array<{ type: string; text?: string }>;
}

export function elideStaleToolResults(
  messages: AgentMessage[],
  keepChars = KEEP_CHARS,
): AgentMessage[] {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if ((messages[i] as { role?: string }).role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex <= 0) return messages;

  return messages.map((message, index) => {
    if (index >= lastUserIndex) return message;
    const result = message as ToolResultLike;
    if (result.role !== "toolResult" || !Array.isArray(result.content)) return message;
    const total = result.content.reduce(
      (sum, block) => sum + (block.type === "text" ? (block.text?.length ?? 0) : 0),
      0,
    );
    if (total <= keepChars) return message;

    const joined = result.content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("\n");
    const stub = `${joined.slice(0, keepChars)}\n…[${total - keepChars} chars of this earlier ${
      result.toolName ?? "tool"
    } result were trimmed from context; call the tool again if you need the full data]`;
    return { ...message, content: [{ type: "text", text: stub }] } as AgentMessage;
  });
}
