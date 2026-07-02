/**
 * ConversationPort over conversation-store。
 * 重要：`append` 是空操作 —— 产品里转录的持久化仍归 useBookConversation /
 * useGlobalConversation（它们存的是带 attachments 的原始消息，对 UI 更有用）。
 * 运行时只*读*转录做水化与原话检索，写摘要（insights）归自己。
 */
import type { ConversationPort, TurnRecord } from "@read-aware/agent";
import { localKV } from "../../../../platform/local-store";
import { loadAllConversations, loadConversation } from "../../lib/conversation-store";
import type { ChatMessage } from "../../lib/chat-types";

/** threadKey（book:<id> | global）↔ conversation-store 的存储键 */
export const GLOBAL_CONVERSATION_ID = "__global__";

function threadKeyToStoreId(threadKey: string): string {
  return threadKey === "global" ? GLOBAL_CONVERSATION_ID : threadKey.replace(/^book:/, "");
}

function storeIdToThreadKey(storeId: string): string {
  return storeId === GLOBAL_CONVERSATION_ID ? "global" : `book:${storeId}`;
}

function toTurns(messages: ChatMessage[]): TurnRecord[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  }));
}

const INSIGHTS_KEY = "read-aware-agent-insights";

function readInsights(): Record<string, string> {
  try {
    return JSON.parse(localKV.getItem(INSIGHTS_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function createConversationPort(): ConversationPort {
  return {
    load: async (threadKey) => toTurns(await loadConversation(threadKeyToStoreId(threadKey))),
    append: async () => {
      // no-op：见文件头注释
    },
    searchTurns: async ({ query, threadKey, limit }) => {
      const all = await loadAllConversations();
      const matches: Array<TurnRecord & { threadKey: string }> = [];
      for (const [storeId, messages] of Object.entries(all)) {
        const key = storeIdToThreadKey(storeId);
        if (threadKey && key !== threadKey) continue;
        for (const turn of toTurns(messages)) {
          if (turn.content.includes(query)) matches.push({ ...turn, threadKey: key });
        }
      }
      return matches.slice(0, limit ?? 20);
    },
    getInsights: async (threadKey) => readInsights()[threadKey],
    putInsights: async (threadKey, summary) => {
      const insights = readInsights();
      insights[threadKey] = summary;
      localKV.setItem(INSIGHTS_KEY, JSON.stringify(insights));
    },
  };
}
