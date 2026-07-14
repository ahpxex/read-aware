import type { ChatAssistantPart, ChatMessage } from "../lib/chat-types";
import { AttachmentChip } from "./AttachmentChip";
import { ChatMessageActions, ChatMessageError } from "./ChatMessageActions";
import { ChatThinking } from "./ChatThinking";
import { ChatToolStep } from "./ChatToolStep";
import { Markdown } from "./Markdown";
import { ReferenceStack } from "./references/ReferenceStack";

/**
 * One turn in the conversation. User turns sit right-aligned in a quiet chip
 * (with any attached passages above); assistant turns read as a left-aligned
 * timeline — thinking disclosures, individual tool-step rows and
 * reference-card stacks interleaved with Markdown prose, in the order they
 * happened — closer to a reading companion than a messaging app. Streaming
 * and settled turns render identically; nothing folds after the fact.
 *
 * Every settled message grows a hover-revealed action row (copy; regenerate
 * when `onRetry` is passed — the transcript only passes it on the last
 * message). A failed turn shows an always-visible error row instead, with its
 * retry inline.
 */
export function ChatMessageItem({
  message,
  streaming = false,
  onRetry,
}: {
  message: ChatMessage;
  streaming?: boolean;
  onRetry?: () => void;
}) {
  if (message.role === "user") {
    const hasText = message.content.trim().length > 0;
    return (
      <div className="group/message flex flex-col items-end gap-1.5">
        {message.attachments?.map((attachment, i) => (
          <AttachmentChip key={i} attachment={attachment} className="max-w-[90%]" />
        ))}
        {hasText && (
          <div className="max-w-[90%] whitespace-pre-wrap rounded-lg bg-fill-strong px-3 py-2 text-sm leading-relaxed text-fg">
            {message.content}
          </div>
        )}
        <ChatMessageActions
          text={hasText ? message.content : undefined}
          onRetry={onRetry}
          align="end"
        />
      </div>
    );
  }

  // Messages persisted before parts existed carry only `content`; a failed
  // turn that produced nothing carries neither (the error row is its body).
  const parts: ChatAssistantPart[] =
    message.parts && message.parts.length > 0
      ? message.parts
      : message.content
        ? [{ type: "text", text: message.content }]
        : [];
  const lastIndex = parts.length - 1;

  return (
    <div className="group/message flex max-w-full flex-col gap-2">
      {parts.map((part, index) => {
        if (part.type === "tool") {
          return <ChatToolStep key={part.id} part={part} />;
        }
        if (part.type === "reference") {
          return <ReferenceStack key={part.id} part={part} />;
        }
        if (part.type === "thinking") {
          return (
            <ChatThinking
              key={index}
              text={part.text}
              streaming={streaming && index === lastIndex}
            />
          );
        }
        return (
          <div key={index} className="max-w-full">
            <Markdown>{part.text}</Markdown>
            {streaming && index === lastIndex && (
              <span className="ra-chat-caret" aria-hidden="true" />
            )}
          </div>
        );
      })}
      {message.error && (
        <ChatMessageError message={message.error} code={message.errorCode} onRetry={onRetry} />
      )}
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
