/**
 * Per-message affordances. `ChatMessageActions` is the hover-revealed action
 * row (copy, and regenerate on the last message); reveal keys off the message
 * wrapper's NAMED group (`group/message`) — Tooltip owns the unnamed `group`,
 * so a bare group here would pin every tooltip open on message hover.
 * `ChatMessageError` is the always-visible failure notice on a failed turn — a
 * compact rounded block in the assistant timeline: a short title, the error
 * detail allowed to wrap (clamped, full text on hover), and an inline retry.
 * Tinted with the same red palette as the design system's destructive Alert.
 */
import { ArrowsClockwise, Check, Copy, WarningCircle } from "@phosphor-icons/react";
import { Button, IconButton, Tooltip } from "@read-aware/ui";
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
    <div
      role="alert"
      className="flex max-w-full items-start gap-2.5 rounded-lg border border-red-200/70 bg-red-50/70 py-2.5 pl-3 pr-2 dark:border-red-900/60 dark:bg-red-950/40"
    >
      <WarningCircle
        size={15}
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-red-700 dark:text-red-400"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-5 text-red-950 dark:text-red-100">
          {t("chat.message.failed")}
        </p>
        {/* The raw error is the actionable part — let it wrap instead of
            truncating, clamped so a stack trace can't swallow the panel. */}
        <p
          className="mt-0.5 line-clamp-3 text-xs leading-relaxed text-red-900/80 [overflow-wrap:anywhere] dark:text-red-200/80"
          title={message}
        >
          {message}
        </p>
      </div>
      {onRetry && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onRetry}
          className="-mt-0.5 h-7 shrink-0 gap-1 px-2 text-xs text-red-800 hover:bg-red-900/10 hover:text-red-950 active:bg-red-900/15 dark:text-red-300 dark:hover:bg-red-100/10 dark:hover:text-red-100"
        >
          <ArrowsClockwise size={13} aria-hidden="true" />
          {t("chat.message.retry")}
        </Button>
      )}
    </div>
  );
}
