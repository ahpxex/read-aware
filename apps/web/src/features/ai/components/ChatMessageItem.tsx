import type { ChatAssistantPart, ChatMessage } from "../lib/chat-types";
import { AttachmentChip } from "./AttachmentChip";
import { ChatThinking } from "./ChatThinking";
import { ChatToolStep } from "./ChatToolStep";
import { Markdown } from "./Markdown";
import { ReferenceStack } from "./references/ReferenceStack";

/**
 * One turn in the conversation. User turns sit right-aligned in a quiet chip
 * (with any attached passages above); assistant turns read as a left-aligned
 * timeline — thinking disclosures and tool-step rows interleaved with Markdown
 * prose, in the order they happened — closer to a reading companion than a
 * messaging app.
 */
export function ChatMessageItem({
  message,
  streaming = false,
}: {
  message: ChatMessage;
  streaming?: boolean;
}) {
  if (message.role === "user") {
    const hasText = message.content.trim().length > 0;
    return (
      <div className="flex flex-col items-end gap-1.5">
        {message.attachments?.map((attachment, i) => (
          <AttachmentChip key={i} attachment={attachment} className="max-w-[90%]" />
        ))}
        {hasText && (
          <div className="max-w-[90%] whitespace-pre-wrap rounded-lg bg-fill-strong px-3 py-2 text-sm leading-relaxed text-fg">
            {message.content}
          </div>
        )}
      </div>
    );
  }

  // Messages persisted before parts existed carry only `content`.
  const parts: ChatAssistantPart[] =
    message.parts && message.parts.length > 0
      ? message.parts
      : [{ type: "text", text: message.content }];
  const lastIndex = parts.length - 1;

  return (
    <div className="flex max-w-full flex-col gap-2">
      {parts.map((part, i) => {
        if (part.type === "tool") {
          return <ChatToolStep key={part.id} part={part} />;
        }
        if (part.type === "reference") {
          return <ReferenceStack key={part.id} part={part} />;
        }
        if (part.type === "thinking") {
          return <ChatThinking key={i} text={part.text} streaming={streaming && i === lastIndex} />;
        }
        return (
          <div key={i} className="max-w-full">
            <Markdown>{part.text}</Markdown>
            {streaming && i === lastIndex && <span className="ra-chat-caret" aria-hidden="true" />}
          </div>
        );
      })}
    </div>
  );
}
