/**
 * ConversationPort over conversation-store（只读转录 + 摘要）。
 * 转录的唯一写入者是聊天界面：useBookConversation / useGlobalConversation 在
 * 一轮开始前保存用户消息（其 id 即 SendTurnInput.turnId），流结束后保存回复，
 * 经 conversation-store → ai_chat_commit 与事件同事务落库。运行时只读转录做
 * 水化与原话检索，按 turnId 区分本轮与历史；写摘要（insights）与线程标题
 * （`aiConversation.titled`）归运行时自己。
 */
import { searchTurnRecords, type ConversationPort, type TurnRecord, type UntitledThread } from "@read-aware/agent";
import {
  clearStoredConversationInsights,
  getStoredConversationInsights,
  putStoredConversationInsights,
} from "../../lib/conversation-insights-store";
import {
  GLOBAL_CONVERSATION_ID,
  isGlobalThreadId,
  listGlobalThreads,
  loadAllConversations,
  loadConversation,
  titleConversation,
} from "../../lib/conversation-store";
import type { ChatMessage } from "../../lib/chat-types";

export { GLOBAL_CONVERSATION_ID };
export { clearStoredConversationInsights } from "../../lib/conversation-insights-store";

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
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      attachments: message.attachments
        ?.filter((attachment) => attachment.kind !== "image")
        .map((attachment) => ({
          text: attachment.text,
          anchor: attachment.cfiRange ?? undefined,
          chapter: attachment.chapterHref ?? undefined,
        })),
    }));
}

export function createConversationPort(): ConversationPort {
  return {
    load: async (threadKey) => toTurns(await loadConversation(threadKeyToStoreId(threadKey))),
    searchTurns: async ({ queries, threadKey, limit, includeAttachments }) => {
      // 匹配核心与 eval 的内存端口同源（searchTurnRecords：多变体合并 +
      // 精确优先 + 词元回退）——此前这里是逐字子串匹配，口语查询几乎
      // 永远命不中原话，工具形同虚设。
      const all = await loadAllConversations();
      const pool: Array<TurnRecord & { threadKey: string }> = [];
      for (const [storeId, messages] of Object.entries(all)) {
        const key = storeIdToThreadKey(storeId);
        if (threadKey && key !== threadKey) continue;
        for (const turn of toTurns(messages))
          pool.push({
            ...turn,
            threadKey: key,
            attachments: includeAttachments === false ? undefined : turn.attachments,
          });
      }
      return searchTurnRecords(pool, queries, limit ?? 20);
    },
    getInsights: async (threadKey) => getStoredConversationInsights(threadKey),
    putInsights: putStoredConversationInsights,
    clearInsights: clearStoredConversationInsights,
    untitledThreads: async ({ limit, threadKey }) => {
      // The list comes most recently active first; only the threads taken are read in full.
      const untitled = (await listGlobalThreads()).filter(
        (thread) => !thread.title && (!threadKey || storeIdToThreadKey(thread.id) === threadKey),
      );
      const out: UntitledThread[] = [];
      for (const thread of untitled) {
        if (out.length >= limit) break;
        const messages = (await loadConversation(thread.id)).filter((message) => !message.error);
        const user = messages.find((message) => message.role === "user" && message.content.trim());
        if (!user) continue;
        const assistant = messages.find((message) => message.role === "assistant" && message.content.trim());
        out.push({
          threadKey: storeIdToThreadKey(thread.id),
          messageId: user.id,
          userText: user.content,
          assistantText: assistant?.content,
        });
      }
      return out;
    },
    titleThread: (threadKey, title, messageId) =>
      titleConversation(threadKeyToStoreId(threadKey), title, messageId, "agent"),
  };
}
