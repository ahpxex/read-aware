import {
  BookOpen,
  CaretLeft,
  CaretRight,
  ChatCircleDots,
  Check,
  Copy,
  Highlighter,
  NotePencil,
  TextUnderline,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { useAskAiEnabled } from "../../ai/hooks/useAskAiEnabled";

type ReaderNavigatorBarProps = {
  visible: boolean;
  /** Identity of the sentence the bar acts on; null while none is resting. */
  sentenceKey: string | null;
  onPrev: () => void;
  onNext: () => void;
  onCopy: () => Promise<void> | void;
  onHighlight: () => void;
  onUnderline: () => void;
  onAddNote: () => void;
  onLookUp: () => void;
  onAskAI: () => void;
  onExit: () => void;
};

/** Hairline divider separating action groups within the bar. */
function BarDivider() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

/**
 * The sentence navigator's floating control strip, pinned to the bottom center
 * of the reader: step to the previous / next sentence, plus the selection
 * menu's actions applied to the sentence the wash is resting on.
 */
export function ReaderNavigatorBar({
  visible,
  sentenceKey,
  onPrev,
  onNext,
  onCopy,
  onHighlight,
  onUnderline,
  onAddNote,
  onLookUp,
  onAskAI,
  onExit,
}: ReaderNavigatorBarProps) {
  const { t } = useTranslation("reader");
  const askEnabled = useAskAiEnabled();
  const copyResetTimeoutRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current != null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  // Moving to another sentence resets the copy feedback.
  useEffect(() => {
    setCopied(false);
    if (copyResetTimeoutRef.current != null) {
      window.clearTimeout(copyResetTimeoutRef.current);
      copyResetTimeoutRef.current = null;
    }
  }, [sentenceKey]);

  if (!visible) return null;

  async function handleCopy() {
    await onCopy();
    setCopied(true);
    if (copyResetTimeoutRef.current != null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopied(false);
      copyResetTimeoutRef.current = null;
    }, 1200);
  }

  const hasSentence = sentenceKey != null;
  // Quiet, monochrome ghost buttons — same surface language as the selection menu.
  const actionButtonClass =
    "rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg focus-visible:ring-fg disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[calc(1.25rem+var(--ra-safe-bottom))] z-30 flex justify-center px-4">
      <div
        role="toolbar"
        aria-label={t("navigator.title")}
        className="ra-motion-overlay-pop pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-0.5 rounded-lg border border-border bg-[var(--ra-main-surface-color)] p-1 shadow-[0_4px_16px_-6px_rgba(28,25,23,0.25)]"
      >
        <IconButton
          label={t("navigator.prevSentence")}
          title={t("navigator.prevSentence")}
          size="sm"
          onClick={onPrev}
          className={actionButtonClass}
          icon={<CaretLeft size={16} weight="regular" aria-hidden="true" />}
        />
        <IconButton
          label={t("navigator.nextSentence")}
          title={t("navigator.nextSentence")}
          size="sm"
          onClick={onNext}
          className={actionButtonClass}
          icon={<CaretRight size={16} weight="regular" aria-hidden="true" />}
        />

        <BarDivider />
        <IconButton
          label={copied ? t("menu.copied") : t("menu.copy")}
          title={copied ? t("menu.copied") : t("menu.copy")}
          size="sm"
          disabled={!hasSentence}
          onClick={() => {
            void handleCopy();
          }}
          className={cn(actionButtonClass, copied && "bg-fill-strong text-fg")}
          icon={
            copied ? (
              <Check size={14} weight="regular" aria-hidden="true" />
            ) : (
              <Copy size={14} weight="regular" aria-hidden="true" />
            )
          }
        />
        <IconButton
          label={t("menu.highlight")}
          title={t("menu.highlight")}
          size="sm"
          disabled={!hasSentence}
          onClick={onHighlight}
          className={actionButtonClass}
          icon={<Highlighter size={14} weight="regular" aria-hidden="true" />}
        />
        <IconButton
          label={t("menu.underline")}
          title={t("menu.underline")}
          size="sm"
          disabled={!hasSentence}
          onClick={onUnderline}
          className={actionButtonClass}
          icon={<TextUnderline size={14} weight="regular" aria-hidden="true" />}
        />
        <IconButton
          label={t("menu.addNote")}
          title={t("menu.addNote")}
          size="sm"
          disabled={!hasSentence}
          onClick={onAddNote}
          className={actionButtonClass}
          icon={<NotePencil size={14} weight="regular" aria-hidden="true" />}
        />

        <BarDivider />
        <IconButton
          label={t("menu.lookUp")}
          title={t("menu.lookUp")}
          size="sm"
          disabled={!hasSentence}
          onClick={onLookUp}
          className={actionButtonClass}
          icon={<BookOpen size={14} weight="regular" aria-hidden="true" />}
        />
        {askEnabled && (
          <IconButton
            label={t("menu.askAi")}
            title={t("menu.askAi")}
            size="sm"
            disabled={!hasSentence}
            onClick={onAskAI}
            className={actionButtonClass}
            icon={<ChatCircleDots size={14} weight="regular" aria-hidden="true" />}
          />
        )}

        <BarDivider />
        <IconButton
          label={t("navigator.exit")}
          title={t("navigator.exit")}
          size="sm"
          onClick={onExit}
          className={actionButtonClass}
          icon={<X size={14} weight="regular" aria-hidden="true" />}
        />
      </div>
    </div>
  );
}
