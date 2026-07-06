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

/** 全局线程（跨书总对话，Context 页）的存储伪 id。 */
export const GLOBAL_CONVERSATION_ID = "__global__";

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
