import { Quotes, X } from "@phosphor-icons/react";
import { IconButton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import type { ChatSelectionAttachment } from "../lib/chat-types";

/**
 * A quoted passage pulled into the conversation via "Ask AI about this". Shown
 * in the composer (with a remove button) before sending, and again on the user
 * turn it was attached to.
 */
export function AttachmentChip({
  attachment,
  onRemove,
  className,
}: {
  attachment: ChatSelectionAttachment;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-1.5 rounded-md bg-fill px-2.5 py-1.5",
        className,
      )}
    >
      <Quotes
        size={12}
        weight="fill"
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-fg-subtle"
      />
      <span className="line-clamp-3 min-w-0 flex-1 text-xs leading-snug text-fg-muted">
        {attachment.text}
      </span>
      {onRemove && (
        <IconButton
          label="Remove passage"
          size="sm"
          onClick={onRemove}
          className="-my-0.5 -mr-1 shrink-0 text-fg-subtle hover:text-fg"
          icon={<X size={12} weight="regular" aria-hidden="true" />}
        />
      )}
    </div>
  );
}
