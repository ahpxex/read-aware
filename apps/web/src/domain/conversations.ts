/**
 * Conversations domain — read-only view over the user's AI threads (one
 * persistent thread per book, keyed by the book id, plus user-created
 * global threads). No `on`: the conversation domain events have no live
 * producer yet; the subscription arrives when the chat layer dual-writes.
 */
import type { ChatMessageSummary, ThreadSummary } from "@read-aware/core";
import {
  listGlobalThreads,
  loadConversation,
} from "../features/ai/lib/conversation-store";

function toMessages(
  messages: Awaited<ReturnType<typeof loadConversation>>,
): ChatMessageSummary[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    }));
}

export type ConversationsDomain = {
  /** The book's persistent thread, oldest first; empty when none. */
  getBookThread(bookId: string): Promise<ChatMessageSummary[]>;
  /** User-created global (Context page) threads. */
  listThreads(): Promise<ThreadSummary[]>;
  getThread(threadId: string): Promise<ChatMessageSummary[]>;
};

export function createConversationsDomain(): ConversationsDomain {
  return {
    getBookThread: async (bookId) => toMessages(await loadConversation(String(bookId))),
    listThreads: async () =>
      (await listGlobalThreads()).map((thread) => ({
        id: thread.id,
        title: thread.preview,
        updatedAt: thread.updatedAt,
      })),
    getThread: async (threadId) => toMessages(await loadConversation(String(threadId))),
  };
}
