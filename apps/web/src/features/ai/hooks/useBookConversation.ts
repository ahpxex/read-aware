import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../../i18n";
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
  error: string | null;
  send: (text: string, attachments?: ChatAttachment[]) => void;
  stop: () => void;
  clear: () => void;
}

/**
 * Owns the per-book conversation: loads it from the store, sends a turn through
 * the response seam, streams the reply, and persists each committed turn. The
 * components stay pure — all the async orchestration lives here.
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
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
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
      void saveConversation(bookId, next);
    },
    [bookId],
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
      const history = messagesRef.current;
      const withUser = [...history, userMessage];
      persist(withUser);

      setError(null);
      setStreamingParts([]);
      setStatus(null);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      void (async () => {
        let assembled: ChatAssistantPart[] = [];
        try {
          const stream = getChatTransport().sendTurn(
            {
              bookId,
              bookTitle,
              history,
              message: userMessage,
              thread,
              chapterHref: chapterHrefRef.current,
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
            setError(
              err instanceof Error ? err.message : t("chat.error.generic"),
            );
          }
        } finally {
          // Commit whatever was produced — even a partial reply after a stop —
          // so the conversation stays a faithful record.
          const parts = finalizeParts(assembled);
          const content = partsText(parts);
          // Reference parts contribute nothing to `content` — a cards-only
          // reply must still persist.
          const hasReference = parts.some((part) => part.type === "reference");
          if (content || hasReference) {
            const assistantMessage: ChatMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              content,
              createdAt: new Date().toISOString(),
              parts,
            };
            persist([...withUser, assistantMessage]);
          }
          setStreamingParts([]);
          setStatus(null);
          setIsStreaming(false);
          abortRef.current = null;
        }
      })();
    },
    [bookId, bookTitle, thread, isStreaming, persist, t],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    void clearConversation(bookId);
  }, [bookId]);

  return { messages, isLoading, isStreaming, streamingParts, status, error, send, stop, clear };
}
