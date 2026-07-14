/**
 * Per-message affordances. `ChatMessageActions` is the hover-revealed action
 * row (copy, and regenerate on the last message); reveal keys off the message
 * wrapper's NAMED group (`group/message`) — Tooltip owns the unnamed `group`,
 * so a bare group here would pin every tooltip open on message hover.
 * `ChatMessageError` is the always-visible failure notice on a failed turn — a
 * compact rounded block in the assistant timeline, kept in the app's quiet
 * stone palette (the icon and title carry the semantics; no red tint): a short
 * title, the failure detail allowed to wrap (clamped, full text on hover), and
 * the recovery actions. A recognized failure code renders localized copy and
 * its fix (e.g. not-configured → open Settings → AI) instead of the raw
 * thrown message.
 */
import { ArrowsClockwise, Check, Copy, WarningCircle } from "@phosphor-icons/react";
import { useSetAtom } from "jotai";
import { Button, IconButton, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { settingsOpenAtom, settingsSectionRequestAtom } from "../../../state/ui";
import { AI_NOT_CONFIGURED } from "../lib/ai-errors";
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
  code,
  onRetry,
}: {
  /** Raw failure detail (the thrown message) — the only clue on unknown errors. */
  message: string;
  /** Recognized failure code (see `ai-errors.ts`) — renders localized copy + fix. */
  code?: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation(["ai", "common"]);
  const setSettingsOpen = useSetAtom(settingsOpenAtom);
  const setSettingsSection = useSetAtom(settingsSectionRequestAtom);
  const notConfigured = code === AI_NOT_CONFIGURED;
  // For a recognized code the localized copy replaces the raw message; for
  // anything else the raw detail IS the actionable part — let it wrap instead
  // of truncating, clamped so a stack trace can't swallow the panel.
  const detail = notConfigured ? t("ai:chat.error.notConfigured") : message;
  return (
    <div
      role="alert"
      className="flex max-w-full items-start gap-2.5 rounded-lg border border-border bg-fill/60 py-2.5 pl-3 pr-2"
    >
      <WarningCircle
        size={15}
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-fg-subtle"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-5 text-fg">
          {t("ai:chat.message.failed")}
        </p>
        <p
          className="mt-0.5 line-clamp-3 text-xs leading-relaxed text-fg-muted [overflow-wrap:anywhere]"
          title={detail}
        >
          {detail}
        </p>
        {notConfigured && (
          <Button
            size="sm"
            variant="outline"
            className="mt-2 h-7 px-2.5 text-xs"
            onClick={() => {
              setSettingsSection("ai");
              setSettingsOpen(true);
            }}
          >
            {t("common:actions.openSettings")}
          </Button>
        )}
      </div>
      {onRetry && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onRetry}
          className="-mt-0.5 h-7 shrink-0 gap-1 px-2 text-xs text-fg-muted hover:text-fg"
        >
          <ArrowsClockwise size={13} aria-hidden="true" />
          {t("ai:chat.message.retry")}
        </Button>
      )}
    </div>
  );
}
