/**
 * transformContext 的窗口化 v1（doc §5：prompt ≠ 转录回放）：
 * 只保留最近 maxTurns 个用户轮。在用户消息边界切割 —— 一轮永远以用户消息开头，
 * 这样窗口里不会出现失去前文 toolCall 的孤儿 toolResult。
 * 被切掉的前缀里的 system 消息（提示词与工具声明）折叠成一条开头消息，
 * 模型看到的提示词和可调用工具与完整转录一致；窗口内的工具变更原位保留。
 * bundle 注入与滚动摘要压缩成型后同样接在这条链上。
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";

function fromIndex(messages: AgentMessage[], start: number): AgentMessage[] {
  if (start === 0) return messages;
  const head = getCurrentSystemMessage(messages.slice(0, start));
  const kept = messages.slice(start);
  return head ? [head, ...kept] : kept;
}

export function windowByTurns(messages: AgentMessage[], maxTurns: number): AgentMessage[] {
  if (maxTurns <= 0) return fromIndex(messages, messages.length);
  let turns = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      turns++;
      if (turns >= maxTurns) return fromIndex(messages, i);
    }
  }
  return messages;
}
