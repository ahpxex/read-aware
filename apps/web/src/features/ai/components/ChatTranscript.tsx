import { ChatCircleDots } from "@phosphor-icons/react";
import { Caption, EmptyState, ScrollArea, Spinner } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { useTranscriptAutoScroll } from "../hooks/useTranscriptAutoScroll";
import type { ChatAssistantPart, ChatMessage } from "../lib/chat-types";
import { ChatMessageItem } from "./ChatMessageItem";

type ChatTranscriptProps = {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingParts: ChatAssistantPart[];
  status: string | null;
};

/** The quiet activity row shown while the model is between visible outputs. */
function ThinkingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-fg-muted">
      <Spinner size="sm" />
      <Caption>{label}</Caption>
    </div>
  );
}

/**
 * The scrolling conversation: prior turns, the in-progress assistant turn
 * (thinking, tool steps and prose as they happen), and a "thinking" indicator
 * whenever the model is working but nothing is streaming — before the first
 * event, and in the gap after a round's tools finish. Scroll policy lives in
 * useTranscriptAutoScroll (anchored by default, opt-in follow).
 */
export function ChatTranscript({
  messages,
  isLoading,
  isStreaming,
  streamingParts,
  status,
}: ChatTranscriptProps) {
  const { t } = useTranslation("ai");
  const { containerRef, liveTurnRef, liveTurnId, liveTurnMinHeight } = useTranscriptAutoScroll({
    messages,
    streamingParts,
    isStreaming,
    isLoading,
  });

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size="sm" label={t("chat.loadingConversation")} />
      </div>
    );
  }

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <EmptyState
          icon={<ChatCircleDots size={28} weight="regular" />}
          title={t("chat.empty.title")}
          description={t("chat.empty.description")}
        />
      </div>
    );
  }

  // After a round's tool calls settle, the model is composing its next step —
  // without this the transcript would sit visually dead until the next chunk.
  // A reference stack can also end a round (suppressed present_* calls leave
  // no tool row behind, only the cards).
  const lastPart = streamingParts[streamingParts.length - 1];
  const awaitingNextRound =
    isStreaming &&
    (lastPart?.type === "tool" || lastPart?.type === "reference") &&
    !streamingParts.some((part) => part.type === "tool" && part.state === "running");

  const liveTurnIndex = liveTurnId
    ? messages.findIndex((message) => message.id === liveTurnId)
    : -1;
  const settledMessages = liveTurnIndex >= 0 ? messages.slice(0, liveTurnIndex) : messages;
  const liveMessages = liveTurnIndex >= 0 ? messages.slice(liveTurnIndex) : [];

  const streamingBlock = isStreaming && (
    <>
      {streamingParts.length > 0 ? (
        <ChatMessageItem
          message={{
            id: "__streaming__",
            role: "assistant",
            content: "",
            parts: streamingParts,
            createdAt: "",
          }}
          streaming
        />
      ) : null}
      {(streamingParts.length === 0 || awaitingNextRound) && (
        <ThinkingRow label={status ?? t("chat.thinking")} />
      )}
    </>
  );

  return (
    <ScrollArea ref={containerRef} className="min-h-0 flex-1">
      {/* ra-chat-selectable opts back into text selection (the app chrome is
          globally non-selectable) so replies and quoted passages can be copied.
          max-w-2xl caps line length for readability on wide surfaces (the
          Context page); the ScrollArea stays full-width so the scrollbar sits
          at the surface edge. In the reader panel the cap is a no-op. */}
      <div className="ra-chat-selectable mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4">

        {settledMessages.map((message) => (
          <ChatMessageItem key={message.id} message={message} />
        ))}

        {liveTurnIndex >= 0 ? (
          /* The live turn: the pinned question plus the reply streaming under
             it. Its min-height (anchored mode) reserves the space the reply
             streams into, so the view never has to chase it. */
          <div
            ref={liveTurnRef}
            className="flex flex-col gap-4"
            style={liveTurnMinHeight ? { minHeight: liveTurnMinHeight } : undefined}
          >
            {liveMessages.map((message) => (
              <ChatMessageItem key={message.id} message={message} />
            ))}
            {streamingBlock}
          </div>
        ) : (
          streamingBlock
        )}
      </div>
    </ScrollArea>
  );
}
