/**
 * Conversations domain — authorized queries and controls over AI threads (one
 * persistent thread per book, keyed by the book id, plus user-created
 * global threads). Message generation stays with the chat runtime; controls
 * share its turn drain rather than fabricating user/assistant messages.
 */
import type { ChatMessageSummary, EventOrigin, ThreadSummary } from "@read-aware/core";
import {
  listGlobalThreads,
  loadConversation,
} from "../features/ai/lib/conversation-store";
import { CONVERSATION_EVENTS, domainSubscribe, type DomainEventSubscribe } from "./events";
import { conversationCommands, conversationSnapshot, conversationTurnRequests, observeConversations } from "./conversation-control";

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

export type ConversationQueries = {
  turnRequests(): Promise<import("@read-aware/core").ConversationTurnRequestSnapshot[]>;
  runtime(): Promise<import("@read-aware/core").ConversationRuntimeSnapshot>;
  /** The book's persistent thread, oldest first; empty when none. */
  getBookThread(bookId: string): Promise<ChatMessageSummary[]>;
  /** User-created global (Context page) threads. */
  listThreads(): Promise<ThreadSummary[]>;
  getThread(threadId: string): Promise<ChatMessageSummary[]>;
};

export type ConversationsDomain = {
  queries: ConversationQueries;
  commands: ReturnType<typeof conversationCommands>;
  events: {
    observeRuntime(handler: (snapshot: import("@read-aware/core").ConversationRuntimeSnapshot) => unknown): () => void;
    subscribe: DomainEventSubscribe<(typeof CONVERSATION_EVENTS)[number]>;
  };
};

export function createConversationsDomain(origin: EventOrigin): ConversationsDomain {
  return {
    queries: {
      turnRequests: async () => conversationTurnRequests.list(origin),
      runtime: async () => conversationSnapshot(),
      getBookThread: async (bookId) => toMessages(await loadConversation(String(bookId))),
      listThreads: async () =>
        (await listGlobalThreads()).map((thread) => ({
          id: thread.id,
          title: thread.preview,
          updatedAt: thread.updatedAt,
        })),
      getThread: async (threadId) => toMessages(await loadConversation(String(threadId))),
    },
    commands: conversationCommands(origin),
    events: { subscribe: domainSubscribe(CONVERSATION_EVENTS, origin), observeRuntime: observeConversations },
  };
}
