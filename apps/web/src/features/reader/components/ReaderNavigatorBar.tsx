import {
  BookOpen,
  CaretLeft,
  CaretRight,
  ChatCircleDots,
  Check,
  Copy,
  Crosshair,
  DotsSixVertical,
  Highlighter,
  Layout,
  NotePencil,
  Paragraph,
  TextUnderline,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { IconButton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { useAskAiEnabled } from "../../ai/hooks/useAskAiEnabled";
import { useDraggableFloat } from "../hooks/useDraggableFloat";
import type { NavigatorGranularity } from "../lib/sentence-index";

type ReaderNavigatorBarProps = {
  visible: boolean;
  /** Identity of the sentence the bar acts on; null while none is resting. */
  sentenceKey: string | null;
  /** Coordinate space the bar floats in when dragged (the reader root). */
  containerRef: RefObject<HTMLElement | null>;
  /** Whether the navigator has a resting sentence to jump back to. */
  canReturn: boolean;
  /** Step unit; the bar carries a quick toggle so switching doesn't require
   *  a trip into Settings. */
  granularity: NavigatorGranularity;
  onToggleGranularity: () => void;
  /** Re-open the reader shell — while tap-to-advance claims the page tap,
   *  this button is the way back to the chrome. */
  onToggleToolbars: () => void;
  onPrev: () => void;
  onNext: () => void;
  onReturnToSentence: () => void;
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
 * The sentence navigator's floating control strip — by default pinned to the
 * bottom center of the reader: step to the previous / next sentence, jump back
 * to the resting sentence, plus the selection menu's actions applied to the
 * sentence the wash is resting on. On coarse-pointer devices the step buttons
 * move out to their own thumb-sized floats (ReaderNavigatorStepButtons) and
 * the bar grows a grip that drags it anywhere; the spot sticks per device.
 */
export function ReaderNavigatorBar({
  visible,
  sentenceKey,
  containerRef,
  canReturn,
  granularity,
  onToggleGranularity,
  onToggleToolbars,
  onPrev,
  onNext,
  onReturnToSentence,
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
  const float = useDraggableFloat({ containerRef, controlId: "navigator-bar" });

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
  // Quiet, monochrome ghost buttons — same surface language as the selection
  // menu. Touch gets a taller target without widening the desktop bar; width
  // stays at 36px so the full strip still fits a phone screen in one row.
  const actionButtonClass =
    "rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg focus-visible:ring-fg disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-10 pointer-coarse:w-9";

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div
        className={
          float.style
            ? // w-max: an absolutely positioned box otherwise shrinks to the
              // space between `left` and the container edge, wrapping the bar
              // once it's dragged off-center.
              "absolute w-max max-w-full -translate-x-1/2 -translate-y-1/2 px-0"
            : "absolute inset-x-0 bottom-[calc(1.25rem+var(--ra-safe-bottom))] flex justify-center px-4"
        }
        style={float.style ?? undefined}
      >
        <div
          role="toolbar"
          aria-label={t("navigator.title")}
          data-ra-float
          className="ra-motion-overlay-pop pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-0.5 rounded-lg border border-border bg-[var(--ra-main-surface-color)] p-1 shadow-[0_4px_16px_-6px_rgba(28,25,23,0.25)]"
        >
          <span
            aria-hidden="true"
            {...float.handleProps}
            className={cn(
              "hidden h-10 shrink-0 cursor-grab touch-none items-center rounded-md px-0.5 text-fg-subtle pointer-coarse:flex",
              float.dragging && "cursor-grabbing text-fg",
            )}
          >
            <DotsSixVertical size={16} weight="bold" aria-hidden="true" />
          </span>

          <div className="flex items-center gap-0.5 pointer-coarse:hidden">
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
          </div>

          <IconButton
            label={t("navigator.returnToSentence")}
            title={t("navigator.returnToSentence")}
            size="sm"
            disabled={!canReturn}
            onClick={onReturnToSentence}
            className={actionButtonClass}
            icon={<Crosshair size={14} weight="regular" aria-hidden="true" />}
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
            label={t("navigator.paragraphMode")}
            title={t("navigator.paragraphMode")}
            size="sm"
            aria-pressed={granularity === "paragraph"}
            onClick={onToggleGranularity}
            className={cn(
              actionButtonClass,
              granularity === "paragraph" && "bg-fill-strong text-fg",
            )}
            icon={<Paragraph size={14} weight="regular" aria-hidden="true" />}
          />
          <IconButton
            label={t("navigator.showToolbars")}
            title={t("navigator.showToolbars")}
            size="sm"
            onClick={onToggleToolbars}
            className={actionButtonClass}
            icon={<Layout size={14} weight="regular" aria-hidden="true" />}
          />

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
    </div>
  );
}
