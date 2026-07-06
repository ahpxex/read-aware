import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../../platform/environment";
import type { ChatAssistantPart, ChatAttachment, ChatMessage } from "./chat-types";

/**
 * Local persistence for the per-book conversation.
 *
 * Desktop (the product): SQLite `ai_conversations` / `ai_messages`
 * (storage.rs migration v6) — one row per message, whole-transcript replace on
 * save (mirrors how the conversation hook commits turns), tombstoned clear.
 *
 * Browser (dev / Storybook): a session-scoped in-memory map. Deliberately NOT
 * a persistence fallback — the browser build is a pure UI shell and the mock
 * transport only needs the transcript to survive within the session.
 */

/** 首个全局线程的存储 id（历史遗留名；新建的全局线程用 thread-<uuid>）。 */
export const GLOBAL_CONVERSATION_ID = "__global__";

/** 全局线程的 id 形状 —— 借此把书线程（裸 bookId）和全局线程区分开。 */
export function isGlobalThreadId(id: string): boolean {
  return id === GLOBAL_CONVERSATION_ID || id.startsWith("thread-");
}

/** 新建全局线程的 id（会话行在第一条消息落库时才产生）。 */
export function newGlobalThreadId(): string {
  return `thread-${crypto.randomUUID()}`;
}

export interface ConversationSummary {
  id: string;
  updatedAt: string;
  messageCount: number;
  /** 首条用户消息，线程列表当标题用。 */
  preview?: string;
}

/** Row shape of the SQLite `ai_messages` projection (see storage.rs). */
interface AiMessageRow {
  id: string;
  conversationId: string;
  role: string;
  seq: number;
  content: string;
  createdAt: string;
  attachmentsJson?: string;
  partsJson?: string;
}

function rowToMessage(row: AiMessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role as ChatMessage["role"],
    content: row.content,
    createdAt: row.createdAt,
    attachments: row.attachmentsJson
      ? (JSON.parse(row.attachmentsJson) as ChatAttachment[])
      : undefined,
    parts: row.partsJson ? (JSON.parse(row.partsJson) as ChatAssistantPart[]) : undefined,
  };
}

function messageToRow(conversationId: string, message: ChatMessage, seq: number): AiMessageRow {
  return {
    id: message.id,
    conversationId,
    role: message.role,
    seq,
    content: message.content,
    createdAt: message.createdAt,
    attachmentsJson: message.attachments ? JSON.stringify(message.attachments) : undefined,
    partsJson: message.parts ? JSON.stringify(message.parts) : undefined,
  };
}

const memoryStore = new Map<string, ChatMessage[]>();

export async function loadConversation(conversationId: string): Promise<ChatMessage[]> {
  if (!isTauri()) return memoryStore.get(conversationId) ?? [];
  const rows = await invoke<AiMessageRow[]>("ai_chat_load", { conversationId });
  return rows.map(rowToMessage);
}

/** 全量转录（agent 的 search_conversation 原话检索用）。 */
export async function loadAllConversations(): Promise<Record<string, ChatMessage[]>> {
  if (!isTauri()) return Object.fromEntries(memoryStore);
  const rows = await invoke<AiMessageRow[]>("ai_chat_load_all");
  const grouped: Record<string, ChatMessage[]> = {};
  for (const row of rows) {
    (grouped[row.conversationId] ??= []).push(rowToMessage(row));
  }
  return grouped;
}

export async function saveConversation(
  conversationId: string,
  messages: ChatMessage[],
): Promise<void> {
  if (!isTauri()) {
    memoryStore.set(conversationId, messages);
    return;
  }
  try {
    await invoke("ai_chat_replace", {
      conversationId,
      messages: messages.map((message, seq) => messageToRow(conversationId, message, seq)),
    });
  } catch (err) {
    // Best-effort, like the kv store before it: a failed persist must not take
    // down the live conversation; the next committed turn retries a full write.
    console.error("[conversation-store] persist failed", err);
  }
}

export async function clearConversation(conversationId: string): Promise<void> {
  if (!isTauri()) {
    memoryStore.delete(conversationId);
    return;
  }
  await invoke("ai_chat_clear", { conversationId });
}

/** 全局线程列表（非空会话，按最近活动排序）。 */
export async function listGlobalThreads(): Promise<ConversationSummary[]> {
  if (!isTauri()) {
    return [...memoryStore.entries()]
      .filter(([id, messages]) => isGlobalThreadId(id) && messages.length > 0)
      .map(([id, messages]) => ({
        id,
        updatedAt: messages[messages.length - 1]?.createdAt ?? "",
        messageCount: messages.length,
        preview: messages.find((m) => m.role === "user")?.content,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  const all = await invoke<ConversationSummary[]>("ai_chat_list");
  return all.filter((summary) => isGlobalThreadId(summary.id));
}
