/**
 * ConversationPort over conversation-store。
 * 重要：`append` 是空操作 —— 产品里转录的持久化仍归 useBookConversation /
 * useGlobalConversation（它们存的是带 attachments 的原始消息，对 UI 更有用）。
 * 运行时只*读*转录做水化与原话检索，写摘要（insights）归自己。
 */
import { searchTurnRecords, type ConversationPort, type TurnRecord } from "@read-aware/agent";
import { localKV } from "../../../../platform/local-store";
import {
  GLOBAL_CONVERSATION_ID,
  isGlobalThreadId,
  loadAllConversations,
  loadConversation,
} from "../../lib/conversation-store";
import type { ChatMessage } from "../../lib/chat-types";

export { GLOBAL_CONVERSATION_ID };

/** threadKey（`book:<id>` | `global:<threadId>`）↔ 会话存储 id（前缀剥掉）。 */
function threadKeyToStoreId(threadKey: string): string {
  return threadKey.replace(/^(book|global):/, "");
}

function storeIdToThreadKey(storeId: string): string {
  return isGlobalThreadId(storeId) ? `global:${storeId}` : `book:${storeId}`;
}

function toTurns(messages: ChatMessage[]): TurnRecord[] {
  // 失败标记的消息不进 agent 的水化与原话检索：空 stub 会变成空助手轮，
  // 半截回答会与重试后的正式回答重复。
  return messages
    .filter((message) => !message.error)
    .map((message) => ({
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      attachments: message.attachments?.map((attachment) => ({
        text: attachment.text,
        anchor: attachment.cfiRange ?? undefined,
        chapter: attachment.chapterHref ?? undefined,
      })),
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

export function clearStoredConversationInsights(threadKey: string): void {
  const insights = readInsights();
  let changed = delete insights[threadKey];
  if (threadKey === `global:${GLOBAL_CONVERSATION_ID}`) {
    changed = delete insights.global || changed;
  }
  if (changed) localKV.setItem(INSIGHTS_KEY, JSON.stringify(insights));
}

export function createConversationPort(): ConversationPort {
  return {
    load: async (threadKey) => toTurns(await loadConversation(threadKeyToStoreId(threadKey))),
    append: async () => {
      // no-op：见文件头注释
    },
    searchTurns: async ({ queries, threadKey, limit }) => {
      // 匹配核心与 eval 的内存端口同源（searchTurnRecords：多变体合并 +
      // 精确优先 + 词元回退）——此前这里是逐字子串匹配，口语查询几乎
      // 永远命不中原话，工具形同虚设。
      const all = await loadAllConversations();
      const pool: Array<TurnRecord & { threadKey: string }> = [];
      for (const [storeId, messages] of Object.entries(all)) {
        const key = storeIdToThreadKey(storeId);
        if (threadKey && key !== threadKey) continue;
        for (const turn of toTurns(messages)) pool.push({ ...turn, threadKey: key });
      }
      return searchTurnRecords(pool, queries, limit ?? 20);
    },
    getInsights: async (threadKey) => {
      const insights = readInsights();
      // 多线程化前全局线程的 key 是裸 "global"——老摘要按新 key 兜底读一次
      return (
        insights[threadKey] ??
        (threadKey === `global:${GLOBAL_CONVERSATION_ID}` ? insights.global : undefined)
      );
    },
    putInsights: async (threadKey, summary) => {
      const insights = readInsights();
      insights[threadKey] = summary;
      localKV.setItem(INSIGHTS_KEY, JSON.stringify(insights));
    },
    clearInsights: async (threadKey) => {
      clearStoredConversationInsights(threadKey);
    },
  };
}
