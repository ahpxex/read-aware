import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ArrowUp, Stop } from "@phosphor-icons/react";
import { IconButton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import type { ChatSelectionAttachment } from "../lib/chat-types";
import { AttachmentChip } from "./AttachmentChip";

export type ChatComposerHandle = { focus: () => void };

type ChatComposerProps = {
  isStreaming: boolean;
  pendingAttachment: ChatSelectionAttachment | null;
  onRemoveAttachment: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
};

const MAX_HEIGHT = 160;

/**
 * The message input: an auto-growing textarea, the pending passage chip, and a
 * send/stop control. Enter sends; Shift+Enter inserts a newline. A turn can be
 * sent with just an attached passage and no typed text.
 */
export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(
  function ChatComposer(
    { isStreaming, pendingAttachment, onRemoveAttachment, onSend, onStop },
    ref,
  ) {
    const [value, setValue] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);

    // Grow with content up to a cap, then let it scroll.
    useLayoutEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    }, [value]);

    const canSend = (value.trim().length > 0 || !!pendingAttachment) && !isStreaming;

    function submit() {
      if (!canSend) return;
      onSend(value);
      setValue("");
    }

    function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    }

    return (
      <div className="shrink-0 border-t border-border px-3 py-3">
        {pendingAttachment && (
          <AttachmentChip
            attachment={pendingAttachment}
            onRemove={onRemoveAttachment}
            className="mb-2"
          />
        )}
        <div className="flex items-end gap-1 rounded-lg bg-fg/5 px-2 py-1.5 transition-shadow focus-within:ring-1 focus-within:ring-fg/15">
          {/* min-h matches the button so a single line stays vertically centered;
              symmetric py keeps the placeholder centered and the auto-grow from
              jumping on first paint. */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Message"
            placeholder={
              pendingAttachment ? "Ask about this passage…" : "Ask about this book…"
            }
            className="min-h-7 max-h-40 flex-1 resize-none bg-transparent px-1 py-0.5 text-sm leading-6 text-fg outline-none placeholder:text-fg-subtle"
          />
          {isStreaming ? (
            <IconButton
              label="Stop generating"
              size="sm"
              onClick={onStop}
              className="shrink-0 rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg"
              icon={<Stop size={15} weight="fill" aria-hidden="true" />}
            />
          ) : (
            <IconButton
              label="Send"
              size="sm"
              onClick={submit}
              disabled={!canSend}
              className={cn(
                "shrink-0 rounded-md transition-colors disabled:pointer-events-none",
                canSend ? "text-fg hover:bg-fg/5" : "text-fg-subtle",
              )}
              icon={<ArrowUp size={15} weight="bold" aria-hidden="true" />}
            />
          )}
        </div>
      </div>
    );
  },
);
