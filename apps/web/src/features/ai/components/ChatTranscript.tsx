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
 * Margin class between adjacent messages. A "turn" = user question + assistant
 * answer — we pull those tight (mt-1.5) and push extra space (mt-6) only at the
 * boundary where a new user question follows an assistant reply, so the scroll
 * reads as Q&A pairs rather than a flat uniform list.
 */
function turnGapClass(
  current: ChatMessage,
  prev: ChatMessage | undefined,
): string {
  if (!prev) return "";
  const isNewTurn = current.role === "user" && prev.role === "assistant";
  return isNewTurn ? "mt-6" : "mt-1.5";
}

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

  const lastMessage = messages[messages.length - 1];

  return (
    <ScrollArea className="min-h-0 flex-1">
      {/* ra-chat-selectable opts back into text selection (the app chrome is
          globally non-selectable) so replies and quoted passages can be copied.
          max-w-[42rem] constrains line length to ~65 chars for readability; the
          outer ScrollArea stays full-width so borders/scrollbar sit at the edge. */}
      <div className="ra-chat-selectable mx-auto flex max-w-[42rem] flex-col px-4 py-4">

        {messages.map((message, i) => (
          <div key={message.id} className={turnGapClass(message, messages[i - 1])}>
            <ChatMessageItem message={message} />
          </div>
        ))}

        {isStreaming &&
          (streamingText ? (
            <div className={turnGapClass(
              { id: "__streaming__", role: "assistant", content: "", createdAt: "" },
              lastMessage,
            )}>
              <ChatMessageItem
                message={{
                  id: "__streaming__",
                  role: "assistant",
                  content: streamingText,
                  createdAt: "",
                }}
                streaming
              />
            </div>
          ) : (
            <div className={`flex items-center gap-2 text-fg-muted ${lastMessage ? turnGapClass(
              { id: "__thinking__", role: "assistant", content: "", createdAt: "" },
              lastMessage,
            ) : ""}`}>
              <Spinner size="sm" />
              <Caption>{status ?? t("chat.thinking")}</Caption>
            </div>
          ))}

        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}
