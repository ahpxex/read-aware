import {
  BookOpen,
  ChatCircleDots,
  Check,
  Copy,
  Highlighter,
  NotePencil,
  TextUnderline,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { isAIConfigured } from "../../ai/lib/ai-service";
import { useAnchoredMenuPosition } from "../hooks/useAnchoredMenuPosition";
import type { ReaderSelectionState } from "../lib/selection-overlay";

type ReaderSelectionMenuProps = {
  selection: ReaderSelectionState | null;
  onCopy: () => Promise<void> | void;
  /** One-click highlight (default color) — applied immediately, no extra step. */
  onHighlight?: () => void;
  onUnderline?: () => void;
  onAddNote?: () => void;
  onLookUp?: () => void;
  onAskAI?: () => void;
  /** When false (e.g. fixed-layout PDF) only the copy action is offered. */
  allowAnnotations?: boolean;
};

/** Hairline divider separating action groups within the bar. */
function MenuDivider() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

export function ReaderSelectionMenu({
  selection,
  onCopy,
  onHighlight,
  onUnderline,
  onAddNote,
  onLookUp,
  onAskAI,
  allowAnnotations = true,
}: ReaderSelectionMenuProps) {
  const { containerRef, menuRef, position } = useAnchoredMenuPosition(selection?.anchorRect);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);

  useEffect(() => {
    setAiConfigured(isAIConfigured());
  }, [selection?.cfiRange]);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current != null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setCopied(false);
    if (copyResetTimeoutRef.current != null) {
      window.clearTimeout(copyResetTimeoutRef.current);
      copyResetTimeoutRef.current = null;
    }
  }, [selection?.cfiRange, selection?.text]);

  if (!selection?.anchorRect) return null;

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

  // Quiet, monochrome ghost button — matches the design system's menu surfaces.
  const actionButtonClass =
    "rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg focus-visible:ring-fg";

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
    >
      <div
        ref={menuRef}
        className="ra-motion-overlay-pop pointer-events-auto absolute flex items-center gap-0.5 rounded-lg border border-border bg-[var(--ra-main-surface-color)] p-1 shadow-[0_4px_16px_-6px_rgba(28,25,23,0.25)]"
        style={position}
      >
        <IconButton
          label={copied ? "Copied" : "Copy selection"}
          title={copied ? "Copied" : "Copy selection"}
          size="sm"
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

        {allowAnnotations && (
          <>
            <MenuDivider />
            <IconButton
              label="Highlight"
              title="Highlight"
              size="sm"
              onClick={() => onHighlight?.()}
              className={actionButtonClass}
              icon={<Highlighter size={14} weight="regular" aria-hidden="true" />}
            />
            <IconButton
              label="Underline"
              title="Underline"
              size="sm"
              onClick={() => onUnderline?.()}
              className={actionButtonClass}
              icon={<TextUnderline size={14} weight="regular" aria-hidden="true" />}
            />
            <IconButton
              label="Add a note"
              title="Add a note"
              size="sm"
              onClick={() => onAddNote?.()}
              className={actionButtonClass}
              icon={<NotePencil size={14} weight="regular" aria-hidden="true" />}
            />

            <MenuDivider />
            <IconButton
              label="Look up"
              title="Look up"
              size="sm"
              onClick={() => onLookUp?.()}
              className={actionButtonClass}
              icon={<BookOpen size={14} weight="regular" aria-hidden="true" />}
            />
            {aiConfigured && (
              <IconButton
                label="Ask AI about this"
                title="Ask AI about this"
                size="sm"
                onClick={() => onAskAI?.()}
                className={actionButtonClass}
                icon={<ChatCircleDots size={14} weight="regular" aria-hidden="true" />}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
