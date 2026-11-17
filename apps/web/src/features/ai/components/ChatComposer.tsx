import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Stop, ImageSquare } from "@phosphor-icons/react";
import { IconButton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import type { ChatSelectionAttachment, ChatImageAttachment as ImageAttachment } from "../lib/chat-types";
import { useChatImages } from "../hooks/useChatImages";
import { ChatImageAttachment } from "./ChatImageAttachment";
import { AttachmentChip } from "./AttachmentChip";
import { useReaderFocusTarget } from "../../reader/hooks/useReaderFocusTarget";
import type { DomainActor } from "../../../platform/domain-actor";
import { focusWithReadingSource } from "../../reader/lib/reading-document-input";

export type ChatComposerHandle = { focus: (origin?: DomainActor) => void; adoptDraft: (text: string) => boolean };

type ChatComposerProps = {
  scope?: "book" | "global";
  readerBookId?: string;
  isStreaming: boolean;
  disabled?: boolean;
  pendingAttachment: ChatSelectionAttachment | null;
  onRemoveAttachment: () => void;
  onSend: (text: string, images?: ImageAttachment[]) => boolean | void;
  onStop: () => void;
};

const MAX_HEIGHT = 160;

/**
 * The message input: an auto-growing textarea, the pending passage chip, and a
 * send/stop control. Enter sends; Shift+Enter inserts a newline. A turn can be
 * sent with just an attached passage and no typed text.
 */
export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer(
  {
    isStreaming,
    disabled = false,
    pendingAttachment,
    onRemoveAttachment,
    onSend,
    onStop,
    readerBookId,
    scope = "book",
  },
  ref,
) {
  const { t } = useTranslation("ai");
  const imageInput = useChatImages();
  const fileRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const valueRef = useRef(value);
  valueRef.current = value;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useReaderFocusTarget(readerBookId, "chat", textareaRef);
  const composingRef = useRef(false);

  // preventScroll: focusing while the panel is still sliding in (translated
  // off-screen) would otherwise scroll it into view and drift the whole overlay.
  useImperativeHandle(
    ref,
    () => ({
      focus: (origin) => {
        if (textareaRef.current) focusWithReadingSource(textareaRef.current, origin);
      },
      adoptDraft: (text) => {
        if (valueRef.current.length > 0) return false;
        valueRef.current = text;
        setValue(text);
        if (textareaRef.current) focusWithReadingSource(textareaRef.current, "user");
        return true;
      },
    }),
    [],
  );

  // Grow with content up to a cap, then let it scroll.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    // An empty draft is one row at its CSS size. Measuring it would force a
    // synchronous layout of the whole surface while it is still mounting.
    if (!value) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    // scrollHeight is 0 while the chat tab is display:none (not yet shown).
    // Don't lock the height to 0 — leave it to the CSS min-height until the
    // textarea is actually visible, then it sizes correctly on first edit.
    if (el.scrollHeight === 0) return;
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const canSend =
    (value.trim().length > 0 || !!pendingAttachment || imageInput.images.length > 0) &&
    !isStreaming &&
    !disabled &&
    !imageInput.loading;

  function submit() {
    if (!canSend) return;
    if (onSend(value, imageInput.images.length ? imageInput.images : undefined) === false) return;
    imageInput.clear();
    valueRef.current = "";
    setValue("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline.
    if (event.key === "Enter" && !event.shiftKey) {
      // The Enter that confirms an IME candidate must not send the message.
      // keyCode 229 is the decisive signal on WebKit (where compositionend
      // can fire before this keydown), isComposing covers Chrome/Firefox,
      // and the ref is a redundant guard tracked via compositionstart/end.
      if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) {
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
        {imageInput.images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {imageInput.images.map((attachment, index) => (
              <ChatImageAttachment
                key={`${attachment.cacheKey}-${index}`}
                attachment={attachment}
                onRemove={() => imageInput.remove(index)}
              />
            ))}
          </div>
        )}
        {pendingAttachment && (
          <AttachmentChip attachment={pendingAttachment} onRemove={onRemoveAttachment} className="mb-2" />
        )}
        {/* Fully bare — no frame at rest or on focus. The textarea spans the full
              width so its overflow scrollbar sits at the outer right edge instead
              of wedged between the text and an inline button; the send button is
              overlaid at the bottom-right, kept clear of the scrollbar. */}
        <div className="relative">
          {/* oxlint-disable-next-line react/forbid-elements -- hidden native file picker for image attachments */}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length) void imageInput.add(files);
            }}
          />
          {/* oxlint-disable-next-line react/forbid-elements -- auto-growing composer with image paste and an overlaid send button */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(event) => {
              valueRef.current = event.target.value;
              setValue(event.target.value);
            }}
            onKeyDown={handleKeyDown}
            onPaste={(event) => {
              if (isStreaming || disabled || imageInput.loading) return;
              const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
              if (files.length) {
                event.preventDefault();
                void imageInput.add(files);
              }
            }}
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
                : t(scope === "global" ? "chat.globalPlaceholder" : "chat.placeholder")
            }
            // Sized with the transcript: what you type should read the same
            // as what comes back.
            className="ra-content-type block max-h-40 min-h-8 w-full resize-none bg-transparent py-1 pr-16 text-fg outline-none placeholder:text-fg-subtle"
          />
          <IconButton
            label={t("chat.attachImage")}
            size="sm"
            icon={<ImageSquare size={16} />}
            disabled={disabled || isStreaming || imageInput.loading}
            onClick={() => fileRef.current?.click()}
            className="absolute bottom-1 right-9 text-fg-muted"
          />
          {isStreaming ? (
            <IconButton
              label={t("chat.stopGenerating")}
              size="sm"
              onClick={onStop}
              className="absolute bottom-1 right-1 rounded-control text-fg-muted hover:bg-fg/5 hover:text-fg"
              icon={<Stop size={15} weight="fill" aria-hidden="true" />}
            />
          ) : (
            <IconButton
              label={t("chat.send")}
              size="sm"
              onClick={submit}
              disabled={!canSend}
              className={cn(
                "absolute bottom-1 right-1 rounded-control transition-colors disabled:pointer-events-none",
                canSend ? "text-fg hover:bg-fg/5" : "text-fg-subtle",
              )}
              icon={<ArrowUp size={15} weight="bold" aria-hidden="true" />}
            />
          )}
        </div>
      </div>
    </div>
  );
});
