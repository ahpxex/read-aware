import type { ChatMessage } from "../lib/chat-types";
import { AttachmentChip } from "./AttachmentChip";
import { Markdown } from "./Markdown";

/**
 * One turn in the conversation. User turns sit right-aligned in a quiet chip
 * (with any attached passages above); assistant turns read as left-aligned
 * Markdown prose — closer to a reading companion than a messaging app.
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
          <div className="max-w-[90%] whitespace-pre-wrap rounded-lg bg-fill px-3 py-2 text-sm leading-relaxed text-fg">
            {message.content}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-full">
      <Markdown>{message.content}</Markdown>
      {streaming && <span className="ra-chat-caret" aria-hidden="true" />}
    </div>
  );
}
