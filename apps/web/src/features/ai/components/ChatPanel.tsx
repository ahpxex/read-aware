import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { Alert } from "@read-aware/ui";
import { useBookConversation } from "../hooks/useBookConversation";
import type { ChatSelectionAttachment } from "../lib/chat-types";
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
  active = false,
}: {
  bookId: string;
  bookTitle: string;
  /** Whether the Chat tab is the visible one — drives autofocus of the composer. */
  active?: boolean;
}) {
  const conversation = useBookConversation(bookId, bookTitle);
  const askAiRequest = useAtomValue(askAiRequestAtom);
  const lastConsumedIdRef = useRef<string | null>(null);
  const [pendingAttachment, setPendingAttachment] =
    useState<ChatSelectionAttachment | null>(null);
  const composerRef = useRef<ChatComposerHandle | null>(null);

  // Autofocus the composer whenever the Chat tab becomes the shown one (a frame
  // later, so the tab panel is no longer display:none).
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [active]);

  // Adopt an "Ask AI about this" dispatch: pull the passage into the composer
  // and focus it. We track the last id handled (rather than clearing the atom)
  // so the shell — which opens this tab off the same dispatch — can't race us.
  useEffect(() => {
    if (!askAiRequest || askAiRequest.bookId !== bookId) return;
    if (askAiRequest.id === lastConsumedIdRef.current) return;
    lastConsumedIdRef.current = askAiRequest.id;
    setPendingAttachment(askAiRequest.attachment);
    // Defer focus a frame: the shell switches to this tab off the same dispatch,
    // so the composer may still be in a hidden (display:none) tab panel right now.
    const frame = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [askAiRequest, bookId]);

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
        streamingText={conversation.streamingText}
        status={conversation.status}
      />
      {conversation.error && (
        <Alert variant="destructive" className="mx-3 mb-2">
          {conversation.error}
        </Alert>
      )}
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
