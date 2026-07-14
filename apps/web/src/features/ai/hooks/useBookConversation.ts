import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../../i18n";
import { AiNotConfiguredError } from "../lib/ai-errors";
import { appendStreamChunk, finalizeParts, partsText } from "../lib/chat-stream";
import { getChatTransport } from "../lib/chat-transport";
import type { ChatAssistantPart, ChatAttachment, ChatMessage } from "../lib/chat-types";
import {
  clearConversation,
  loadConversation,
  saveConversation,
} from "../lib/conversation-store";

export interface BookConversation {
  messages: ChatMessage[];
  /** Initial load of the persisted conversation. */
  isLoading: boolean;
  isStreaming: boolean;
  /** The assistant turn assembled so far — prose, thinking and tool steps in order. */
  streamingParts: ChatAssistantPart[];
  /** Human-readable progress from the transport (e.g. "Thinking…"). */
  status: string | null;
  send: (text: string, attachments?: ChatAttachment[]) => void;
  /**
   * Re-run the last user turn: drops whatever reply followed it (failed or
   * not), persists the truncation, and regenerates with the agent's thread
   * memory reset. No-op while streaming or on an empty transcript.
   */
  retry: () => void;
  stop: () => void;
  clear: () => void;
}

/**
 * Owns the per-book conversation: loads it from the store, sends a turn through
 * the response seam, streams the reply, and persists each committed turn. The
 * components stay pure — all the async orchestration lives here.
 *
 * Failures live on the message, not the conversation: a failed turn commits an
 * assistant message carrying `error` (possibly with a partial reply), and the
 * transcript renders the inline error row + retry on it.
 */
export function useBookConversation(
  bookId: string,
  bookTitle: string,
  thread: "book" | "global" = "book",
  /**
   * The reader's current chapter (href) — sampled at send time and stamped on
   * each turn so the agent can scope its chapter session. Book thread only.
   */
  chapterHref: string | null = null,
): BookConversation {
  const { t } = useTranslation("ai");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingParts, setStreamingParts] = useState<ChatAssistantPart[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Latest committed messages, reachable synchronously inside the async turn.
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  // Sampled at send time via a ref so `send` stays stable across page turns.
  const chapterHrefRef = useRef<string | null>(chapterHref);
  chapterHrefRef.current = chapterHref;

  // (Re)load the persisted conversation when the book changes; abort any
  // in-flight turn from the previous book.
  useEffect(() => {
    let alive = true;
    setIsLoading(true);
    void loadConversation(bookId).then((loaded) => {
      if (!alive) return;
      setMessages(loaded);
      setIsLoading(false);
    });
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [bookId]);

  const persist = useCallback(
    (next: ChatMessage[]) => {
      setMessages(next);
      return saveConversation(bookId, next); // best-effort internally
    },
    [bookId],
  );

  /**
   * The shared turn body: persist the user turn, stream the reply, commit the
   * assistant message. `reset` (retry/regenerate) makes the transport discard
   * the agent's thread memory so the turn rebuilds from the persisted
   * transcript — which is why the persist is awaited before the stream starts.
   */
  const runTurn = useCallback(
    (history: ChatMessage[], userMessage: ChatMessage, reset = false) => {
      const withUser = [...history, userMessage];
      const persisted = persist(withUser);

      setStreamingParts([]);
      setStatus(null);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      void (async () => {
        let assembled: ChatAssistantPart[] = [];
        let failure: string | null = null;
        let failureCode: string | undefined;
        try {
          // The truncated transcript must be on disk before the agent
          // rehydrates from it (load-bearing for retry on the global thread).
          await persisted;
          const stream = getChatTransport().sendTurn(
            {
              bookId,
              bookTitle,
              history,
              message: userMessage,
              thread,
              chapterHref: chapterHrefRef.current,
              reset,
            },
            controller.signal,
          );
          for await (const chunk of stream) {
            if (controller.signal.aborted) break;
            if (chunk.type === "status") {
              setStatus(chunk.status);
            } else {
              assembled = appendStreamChunk(assembled, chunk);
              setStreamingParts(assembled);
            }
          }
        } catch (err) {
          const aborted =
            controller.signal.aborted ||
            (err instanceof DOMException && err.name === "AbortError");
          if (!aborted) {
            failure =
              err instanceof Error && err.message ? err.message : t("chat.error.generic");
            if (err instanceof AiNotConfiguredError) failureCode = err.code;
          }
        } finally {
          // Commit whatever was produced — even a partial reply after a stop —
          // so the conversation stays a faithful record. Reference parts
          // contribute nothing to `content`, so a cards-only reply must still
          // persist; a failure with no output persists an error-only stub so
          // the retry affordance has a message to live on.
          const parts = finalizeParts(assembled);
          const content = partsText(parts);
          const hasReference = parts.some((part) => part.type === "reference");
          if (content || hasReference || failure) {
            const assistantMessage: ChatMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              content,
              createdAt: new Date().toISOString(),
              parts: parts.length > 0 ? parts : undefined,
              error: failure ?? undefined,
              errorCode: failure ? failureCode : undefined,
            };
            void persist([...withUser, assistantMessage]);
          }
          setStreamingParts([]);
          setStatus(null);
          setIsStreaming(false);
          abortRef.current = null;
        }
      })();
    },
    [bookId, bookTitle, thread, persist, t],
  );

  const send = useCallback(
    (text: string, attachments?: ChatAttachment[]) => {
      const trimmed = text.trim();
      const hasAttachment = !!attachments && attachments.length > 0;
      if ((!trimmed && !hasAttachment) || isStreaming) return;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString(),
        attachments: hasAttachment ? attachments : undefined,
      };
      runTurn(messagesRef.current, userMessage);
    },
    [isStreaming, runTurn],
  );

  const retry = useCallback(() => {
    if (isStreaming) return;
    const current = messagesRef.current;
    let lastUserIndex = -1;
    for (let i = current.length - 1; i >= 0; i -= 1) {
      if (current[i].role === "user") {
        lastUserIndex = i;
        break;
      }
    }
    if (lastUserIndex < 0) return;
    // Same user message object — id, attachments and timestamp preserved.
    runTurn(current.slice(0, lastUserIndex), current[lastUserIndex], true);
  }, [isStreaming, runTurn]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    void clearConversation(bookId);
    // TODO: the agent thread's in-memory state survives a clear until the next
    // reset turn or app restart — route clears through SendTurnInput.reset (or
    // a runtime-level discard) when clearing becomes thread-aware.
  }, [bookId]);

  return { messages, isLoading, isStreaming, streamingParts, status, send, retry, stop, clear };
}
