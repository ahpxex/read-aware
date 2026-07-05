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
import { useTranslation } from "../../../i18n";
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
    const { t } = useTranslation("ai");
    const [value, setValue] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const composingRef = useRef(false);

    // preventScroll: focusing while the panel is still sliding in (translated
    // off-screen) would otherwise scroll it into view and drift the whole overlay.
    useImperativeHandle(
      ref,
      () => ({ focus: () => textareaRef.current?.focus({ preventScroll: true }) }),
      [],
    );

    // Grow with content up to a cap, then let it scroll.
    useLayoutEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      // scrollHeight is 0 while the chat tab is display:none (not yet shown).
      // Don't lock the height to 0 — leave it to the CSS min-height until the
      // textarea is actually visible, then it sizes correctly on first edit.
      if (el.scrollHeight === 0) return;
      el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    }, [value]);

    const canSend = (value.trim().length > 0 || !!pendingAttachment) && !isStreaming;

    function submit() {
      if (!canSend) return;
      onSend(value);
      setValue("");
    }

    function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
      // Enter sends; Shift+Enter inserts a newline.
      if (event.key === "Enter" && !event.shiftKey) {
        // The Enter that confirms an IME candidate must not send the message.
        // keyCode 229 is the decisive signal on WebKit (where compositionend
        // can fire before this keydown), isComposing covers Chrome/Firefox,
        // and the ref is a redundant guard tracked via compositionstart/end.
        if (
          composingRef.current ||
          event.nativeEvent.isComposing ||
          event.keyCode === 229
        ) {
          return;
        }
        event.preventDefault();
        submit();
      }
    }

    return (
      // The border-t spans the full surface width; the inner wrapper caps the
      // content to the same measure as the transcript column (no-op in the
      // reader panel, centers the composer on the wide Context page).
      // The composer always sits at the very bottom of its surface (Context
      // page and reader chat sheet alike), so it pads itself clear of the
      // home indicator; --ra-safe-bottom is zero on desktop.
      <div className="shrink-0 border-t border-border px-3 pt-3 pb-[calc(0.75rem+var(--ra-safe-bottom))]">
        <div className="mx-auto w-full max-w-2xl">
          {pendingAttachment && (
            <AttachmentChip
              attachment={pendingAttachment}
              onRemove={onRemoveAttachment}
              className="mb-2"
            />
          )}
          {/* Fully bare — no frame at rest or on focus. The textarea spans the full
              width so its overflow scrollbar sits at the outer right edge instead
              of wedged between the text and an inline button; the send button is
              overlaid at the bottom-right, kept clear of the scrollbar. */}
          <div className="relative">
            <textarea
              ref={textareaRef}
              rows={1}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
              aria-label={t("chat.messageLabel")}
              placeholder={
                pendingAttachment
                  ? t("chat.placeholderWithPassage")
                  : t("chat.placeholder")
              }
              className="block max-h-40 min-h-8 w-full resize-none bg-transparent py-1 pr-9 text-sm leading-6 text-fg outline-none placeholder:text-fg-subtle"
            />
            {isStreaming ? (
              <IconButton
                label={t("chat.stopGenerating")}
                size="sm"
                onClick={onStop}
                className="absolute bottom-1 right-1 rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg"
                icon={<Stop size={15} weight="fill" aria-hidden="true" />}
              />
            ) : (
              <IconButton
                label={t("chat.send")}
                size="sm"
                onClick={submit}
                disabled={!canSend}
                className={cn(
                  "absolute bottom-1 right-1 rounded-md transition-colors disabled:pointer-events-none",
                  canSend ? "text-fg hover:bg-fg/5" : "text-fg-subtle",
                )}
                icon={<ArrowUp size={15} weight="bold" aria-hidden="true" />}
              />
            )}
          </div>
        </div>
      </div>
    );
  },
);
