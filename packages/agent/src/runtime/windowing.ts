/**
 * transformContext 的窗口化 v1（doc §5：prompt ≠ 转录回放）：
 * 只保留最近 maxTurns 个用户轮。在用户消息边界切割 —— 一轮永远以用户消息开头，
 * 这样窗口里不会出现失去前文 toolCall 的孤儿 toolResult。
 * bundle 注入与滚动摘要压缩成型后同样接在这条链上。
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export function windowByTurns(messages: AgentMessage[], maxTurns: number): AgentMessage[] {
  if (maxTurns <= 0) return [];
  let turns = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: string };
    if (message.role === "user") {
      turns++;
      if (turns >= maxTurns) return messages.slice(i);
    }
  }
  return messages;
}
