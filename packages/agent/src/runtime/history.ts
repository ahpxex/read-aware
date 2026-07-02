/**
 * 持久化转录（TurnRecord）↔ pi AgentMessage 的换算。
 * 水化出的助手消息借用当前模型的 api/provider 标识，保证 pi-ai 的
 * 跨 provider 消息变换把它们当作已知格式处理。
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import type { TurnRecord } from "../ports";

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function turnRecordsToMessages(records: TurnRecord[], model: Model<Api>): AgentMessage[] {
  return records.map((record) => {
    const timestamp = Date.parse(record.createdAt) || Date.now();
    if (record.role === "user") {
      return { role: "user", content: record.content, timestamp };
    }
    const assistant: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: record.content }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: emptyUsage(),
      stopReason: "stop",
      timestamp,
    };
    return assistant;
  });
}

export function lastAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if ("role" in message && message.role === "assistant" && Array.isArray(message.content)) {
      return message.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("");
    }
  }
  return "";
}
