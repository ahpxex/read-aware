import type { ChatAssistantPart, ChatMessage } from "../lib/chat-types";
import { consolidateThinkingParts } from "../lib/chat-stream";
import { groupChatActivity } from "../lib/chat-activity";
import { AttachmentChip } from "./AttachmentChip";
import { ChatImageAttachment } from "./ChatImageAttachment";
import { ChatActivity } from "./ChatActivity";
import { ChatMessageActions, ChatMessageError } from "./ChatMessageActions";
import { ChatInteractionPrompt } from "./ChatInteractionPrompt";
import { ChatThinking } from "./ChatThinking";
import { ChatToolStep } from "./ChatToolStep";
import { Markdown } from "./Markdown";
import { ReferenceStack } from "./references/ReferenceStack";

/**
 * One turn in the conversation. User turns sit right-aligned in a quiet chip
 * (with any attached passages above); assistant turns read as a left-aligned
 * timeline — one activity disclosure for tools and reasoning, with reference
 * stacks and Markdown prose kept in their original order outside it.
 *
 * Every settled message grows a hover-revealed action row (copy; regenerate
 * when `onRetry` is passed — the transcript only passes it on the last
 * message). A failed turn shows an always-visible error row instead, with its
 * retry inline.
 */
export function ChatMessageItem({
  message,
  streaming = false,
  pendingStatus,
  onRetry,
}: {
  message: ChatMessage;
  streaming?: boolean;
  pendingStatus?: string;
  onRetry?: () => void;
}) {
  if (message.role === "user") {
    const hasText = message.content.trim().length > 0;
    return (
      <div className="group/message flex flex-col items-end gap-1.5">
        {message.attachments?.map((attachment, i) =>
          attachment.kind === "image" ? (
            <ChatImageAttachment key={i} attachment={attachment} />
          ) : (
            <AttachmentChip key={i} attachment={attachment} className="max-w-[90%]" />
          ),
        )}
        {/* Your own turn is content too — it sizes with the reply below it,
            not with the chrome. */}
        {hasText && (
          <div className="ra-content-type max-w-[90%] whitespace-pre-wrap rounded-surface bg-fill-strong px-3 py-2 text-fg">
            {message.content}
          </div>
        )}
        <ChatMessageActions text={hasText ? message.content : undefined} onRetry={onRetry} align="end" />
      </div>
    );
  }

  // Messages persisted before parts existed carry only `content`; a failed
  // turn that produced nothing carries neither (the error row is its body).
  const rawParts: ChatAssistantPart[] =
    message.parts && message.parts.length > 0
      ? message.parts
      : message.content
        ? [{ type: "text", text: message.content }]
        : [];
  // Older persisted turns may predate turn-level reasoning consolidation.
  const parts = consolidateThinkingParts(rawParts, !streaming);
  const lastPart = parts.at(-1);
  const visibleParts = groupChatActivity(parts);

  return (
    <div className="group/message flex max-w-full flex-col gap-2">
      {visibleParts.map((part, index) => {
        if (part.type === "activity") {
          return (
            <ChatActivity
              key="activity"
              part={part}
              streaming={streaming}
              thinking={streaming && lastPart?.type === "thinking"}
              pendingStatus={streaming ? pendingStatus : undefined}
            />
          );
        }
        if (part.type === "tool") {
          return <ChatToolStep key={part.id} part={part} />;
        }
        if (part.type === "reference") {
          return <ReferenceStack key={part.id} part={part} />;
        }
        if (part.type === "interaction") {
          return <ChatInteractionPrompt key={part.id} part={part} />;
        }
        if (part.type === "thinking") {
          return <ChatThinking key={index} text={part.text} streaming={streaming && part === lastPart} />;
        }
        return (
          <div key={index} className="max-w-full">
            <Markdown>{part.text}</Markdown>
            {streaming && part === lastPart && <span className="ra-chat-caret" aria-hidden="true" />}
          </div>
        );
      })}
      {message.error && <ChatMessageError code={message.errorCode} onRetry={onRetry} />}
      {!streaming && (
        <ChatMessageActions
          text={message.content || undefined}
          // A failed turn retries via its error row — don't double the affordance.
          onRetry={message.error ? undefined : onRetry}
        />
      )}
    </div>
  );
}
