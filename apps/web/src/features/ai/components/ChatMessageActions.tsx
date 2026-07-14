/**
 * Per-message affordances. `ChatMessageActions` is the hover-revealed action
 * row (copy, and regenerate on the last message); reveal keys off the message
 * wrapper's NAMED group (`group/message`) — Tooltip owns the unnamed `group`,
 * so a bare group here would pin every tooltip open on message hover.
 * `ChatMessageError` is the always-visible failure notice on a failed turn — a
 * compact rounded block in the assistant timeline, kept in the app's quiet
 * stone palette (typography carries the semantics; no icon, no red tint): the
 * title line with retry on its right, then the failure detail allowed to wrap
 * (clamped, full text on hover). A recognized failure code renders localized
 * copy with its fix inline at the end of the sentence (e.g. not-configured →
 * an "open settings" link) instead of the raw thrown message.
 */
import { ArrowsClockwise, Check, Copy } from "@phosphor-icons/react";
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
  // of truncating, clamped so a stack trace can't swallow the panel. (Known
  // codes carry one short sentence, so the inline fix link never clamps.)
  const detail = notConfigured ? t("ai:chat.error.notConfigured") : message;
  return (
    <div
      role="alert"
      className="max-w-full rounded-lg border border-border bg-fill/60 px-3.5 py-2.5"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium leading-5 text-fg">
          {t("ai:chat.message.failed")}
        </p>
        {onRetry && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onRetry}
            className="-my-1 -mr-1.5 h-7 shrink-0 gap-1 px-2 text-xs text-fg-muted hover:text-fg"
          >
            <ArrowsClockwise size={13} aria-hidden="true" />
            {t("ai:chat.message.retry")}
          </Button>
        )}
      </div>
      <p
        className="mt-0.5 line-clamp-3 text-xs leading-relaxed text-fg-muted [overflow-wrap:anywhere]"
        title={detail}
      >
        {detail}
        {notConfigured && (
          <>
            {" "}
            <Button
              variant="link"
              onClick={() => {
                setSettingsSection("ai");
                setSettingsOpen(true);
              }}
              className="h-auto p-0 align-baseline text-xs underline underline-offset-2"
            >
              {t("common:actions.openSettings")}
            </Button>
          </>
        )}
      </p>
    </div>
  );
}
