/**
 * Per-message affordances. `ChatMessageActions` is the hover-revealed action
 * row (copy, and regenerate on the last message); reveal keys off the message
 * wrapper's NAMED group (`group/message`) — Tooltip owns the unnamed `group`,
 * so a bare group here would pin every tooltip open on message hover.
 * `ChatMessageError` is the always-visible failure row on a failed turn — a
 * quiet caption with an inline retry, not a banner.
 */
import { ArrowsClockwise, Check, Copy, WarningCircle } from "@phosphor-icons/react";
import { Button, Caption, IconButton, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";

export function ChatMessageActions({
  text,
  onRetry,
  align = "start",
}: {
  /** What copy copies (the plain-text projection); omit to hide the copy action. */
  text?: string;
  /** Regenerate the reply; only passed on the transcript's last message. */
  onRetry?: () => void;
  align?: "start" | "end";
}) {
  const { t } = useTranslation("ai");
  const { copied, copy } = useCopyToClipboard();
  if (!text && !onRetry) return null;

  // The tooltip bubble is always laid out (opacity-hidden) and, centered on a
  // panel-edge button, would poke past the transcript and conjure a horizontal
  // scrollbar — pin it to the message's edge instead (see Tooltip's align).
  const tooltipAlign = align;

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 opacity-0 transition-opacity",
        "focus-within:opacity-100 group-hover/message:opacity-100",
        align === "end" && "justify-end",
      )}
    >
      {text && (
        <Tooltip
          content={copied ? t("chat.message.copied") : t("chat.message.copy")}
          align={tooltipAlign}
        >
          <IconButton
            size="sm"
            className="h-6 w-6"
            label={t("chat.message.copy")}
            icon={copied ? <Check size={14} /> : <Copy size={14} />}
            onClick={() => void copy(text)}
          />
        </Tooltip>
      )}
      {onRetry && (
        <Tooltip content={t("chat.message.regenerate")} align={tooltipAlign}>
          <IconButton
            size="sm"
            className="h-6 w-6"
            label={t("chat.message.regenerate")}
            icon={<ArrowsClockwise size={14} />}
            onClick={onRetry}
          />
        </Tooltip>
      )}
    </div>
  );
}

export function ChatMessageError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation("ai");
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <WarningCircle
        size={13}
        aria-hidden="true"
        className="shrink-0 text-red-700 dark:text-red-400"
      />
      <Caption className="truncate text-red-700 dark:text-red-400" title={message}>
        {t("chat.message.failed")} — {message}
      </Caption>
      {onRetry && (
        <Button size="sm" variant="link" className="shrink-0" onClick={onRetry}>
          {t("chat.message.retry")}
        </Button>
      )}
    </div>
  );
}
