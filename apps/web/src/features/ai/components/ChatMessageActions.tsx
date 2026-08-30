/**
 * Per-message affordances. `ChatMessageActions` is the hover-revealed action
 * row (copy, and regenerate on the last message); reveal keys off the message
 * wrapper's NAMED group (`group/message`) — Tooltip owns the unnamed `group`,
 * so a bare group here would pin every tooltip open on message hover.
 * `ChatMessageError` is the always-visible failure notice on a failed turn:
 * the shared `InlineError` card with localized copy resolved from the turn's
 * stable `errorCode` (`describeErrorCode`) — the raw thrown message is never
 * rendered (it lives in the log and the message's `error` column for
 * diagnostics). A code with a fix surface (no key / bad key) appends an
 * inline "open settings" link.
 */
import { ArrowsClockwise, Check, Copy } from "@phosphor-icons/react";
import { useSetAtom } from "jotai";
import { Button, IconButton, InlineError, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { describeErrorCode, useTranslation } from "../../../i18n";
import { settingsOpenAtom, settingsSectionRequestAtom } from "../../../state/ui";
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
  code,
  onRetry,
}: {
  /** The turn's stable failure code (persisted `errorCode`; may be absent). */
  code?: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation(["ai", "common"]);
  const setSettingsOpen = useSetAtom(settingsOpenAtom);
  const setSettingsSection = useSetAtom(settingsSectionRequestAtom);
  const described = describeErrorCode(code);
  return (
    <InlineError
      title={t("ai:chat.message.failed")}
      onRetry={onRetry}
      retryLabel={t("ai:chat.message.retry")}
      action={
        described?.action === "open-ai-settings" ? (
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
        ) : undefined
      }
    >
      {described?.body ?? t("ai:chat.error.generic")}
    </InlineError>
  );
}
