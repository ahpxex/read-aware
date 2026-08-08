import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { useBookConversation } from "../hooks/useBookConversation";
import type { ChatReadingCursor, ChatSelectionAttachment } from "../lib/chat-types";
import { askAiRequestAtom } from "../state/chat-intent";
import { ChatComposer, type ChatComposerHandle } from "./ChatComposer";
import { ChatTranscript } from "./ChatTranscript";

/**
 * The book's AI conversation, rendered as panel content (the note panel owns the
 * tab chrome). One persistent conversation per book; "Ask AI about this" feeds a
 * passage into the composer rather than opening a new thread.
 */
export function ChatPanel({
  bookId,
  bookTitle,
  focusRequestId = 0,
  readingCursor = null,
}: {
  bookId: string;
  bookTitle: string;
  /**
   * Bumped by the host each time the reader *opens* this panel — that gesture,
   * and only that one, puts the caret in the composer. It is deliberately not a
   * "panel is visible" flag: the panel also comes back into view whenever the
   * dismissed reader chrome is revealed again, and focusing there would raise
   * the phone's soft keyboard over a page the reader only meant to look at.
   */
  focusRequestId?: number;
  /** Live viewport snapshot, sampled again by the conversation hook at send time. */
  readingCursor?: ChatReadingCursor | null;
}) {
  const conversation = useBookConversation(bookId, bookTitle, "book", readingCursor);
  const askAiRequest = useAtomValue(askAiRequestAtom);
  const lastConsumedIdRef = useRef<string | null>(null);
  const [pendingAttachment, setPendingAttachment] =
    useState<ChatSelectionAttachment | null>(null);
  const composerRef = useRef<ChatComposerHandle | null>(null);

  // Focus the composer when the host reports the panel was just opened (a frame
  // later, after the slide-in has started so focus lands cleanly).
  useEffect(() => {
    if (!focusRequestId) return;
    const frame = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusRequestId]);

  // Adopt a dispatch from the reader. A passage goes into the composer for the
  // reader to write around; a prompt is sent as its own turn. We track the last
  // id handled (rather than clearing the atom) so the shell — which opens this
  // tab off the same dispatch — can't race us.
  useEffect(() => {
    if (!askAiRequest || askAiRequest.bookId !== bookId) return;
    if (askAiRequest.id === lastConsumedIdRef.current) return;
    lastConsumedIdRef.current = askAiRequest.id;
    if (askAiRequest.prompt) {
      conversation.send(askAiRequest.prompt);
      return;
    }
    setPendingAttachment(askAiRequest.attachment ?? null);
    // Defer focus a frame: the shell switches to this tab off the same dispatch,
    // so the composer may still be in a hidden (display:none) tab panel right now.
    const frame = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [askAiRequest, bookId, conversation]);

  function handleSend(text: string) {
    conversation.send(text, pendingAttachment ? [pendingAttachment] : undefined);
    setPendingAttachment(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatTranscript
        messages={conversation.messages}
        isLoading={conversation.isLoading}
        isStreaming={conversation.isStreaming}
        streamingParts={conversation.streamingParts}
        status={conversation.status}
        onRetry={conversation.retry}
      />
      <ChatComposer
        ref={composerRef}
        isStreaming={conversation.isStreaming}
        pendingAttachment={pendingAttachment}
        onRemoveAttachment={() => setPendingAttachment(null)}
        onSend={handleSend}
        onStop={conversation.stop}
      />
    </div>
  );
}
