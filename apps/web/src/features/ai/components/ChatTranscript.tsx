import { useEffect, useRef } from "react";
import { ChatCircleDots } from "@phosphor-icons/react";
import { Caption, EmptyState, ScrollArea, Spinner } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { ChatMessage } from "../lib/chat-types";
import { ChatMessageItem } from "./ChatMessageItem";

type ChatTranscriptProps = {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingText: string;
  status: string | null;
};

/**
 * The scrolling conversation: prior turns, the in-progress assistant reply, and
 * a "thinking" indicator before the first token. Owns auto-scroll-to-bottom.
 */
export function ChatTranscript({
  messages,
  isLoading,
  isStreaming,
  streamingText,
  status,
}: ChatTranscriptProps) {
  const { t } = useTranslation("ai");
  const endRef = useRef<HTMLDivElement | null>(null);

  // Keep the latest turn in view as messages arrive and the reply streams in.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, streamingText, isStreaming]);

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

  return (
    <ScrollArea className="min-h-0 flex-1">
      {/* ra-chat-selectable opts back into text selection (the app chrome is
          globally non-selectable) so replies and quoted passages can be copied.
          max-w-2xl caps line length for readability on wide surfaces (the
          Context page); the ScrollArea stays full-width so the scrollbar sits
          at the surface edge. In the reader panel the cap is a no-op. */}
      <div className="ra-chat-selectable mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4">

        {messages.map((message) => (
          <ChatMessageItem key={message.id} message={message} />
        ))}

        {isStreaming &&
          (streamingText ? (
            <ChatMessageItem
              message={{
                id: "__streaming__",
                role: "assistant",
                content: streamingText,
                createdAt: "",
              }}
              streaming
            />
          ) : (
            <div className="flex items-center gap-2 text-fg-muted">
              <Spinner size="sm" />
              <Caption>{status ?? t("chat.thinking")}</Caption>
            </div>
          ))}

        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}
