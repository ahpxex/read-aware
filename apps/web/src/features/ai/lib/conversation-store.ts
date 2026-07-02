import type { ChatMessage } from "./chat-types";
import { localKV } from "../../../platform/local-store";

/**
 * Local persistence for the per-book conversation.
 *
 * Interim storage: a single localStorage record keyed by book id. The API is
 * async on purpose so the swap to the event-sourced on-device store (or the
 * sync backend) is invisible to callers — see `docs/data-model.md` (`ai_chat`,
 * `ai_chat_message`). Conversations are local projections; nothing here is the
 * source of truth once the event log exists.
 */

const STORAGE_KEY = "read-aware-conversations";

/** 全局线程（跨书总对话，Context 页）的存储伪 id。 */
export const GLOBAL_CONVERSATION_ID = "__global__";

type ConversationStore = Record<string, ChatMessage[]>;

function readStore(): ConversationStore {
  try {
    const raw = localKV.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as ConversationStore;
  } catch {
    return {};
  }
}

function writeStore(store: ConversationStore): void {
  try {
    localKV.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Best-effort: ignore quota / serialization failures.
  }
}

export async function loadConversation(bookId: string): Promise<ChatMessage[]> {
  return readStore()[bookId] ?? [];
}

/** 全量转录（agent 的 search_conversation 原话检索用）。 */
export async function loadAllConversations(): Promise<Record<string, ChatMessage[]>> {
  return readStore();
}

export async function saveConversation(bookId: string, messages: ChatMessage[]): Promise<void> {
  const store = readStore();
  store[bookId] = messages;
  writeStore(store);
}

export async function clearConversation(bookId: string): Promise<void> {
  const store = readStore();
  delete store[bookId];
  writeStore(store);
}
