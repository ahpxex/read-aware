import {
  BookOpen,
  ChatCircleDots,
  Check,
  Copy,
  NotePencil,
  Trash,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { isAIConfigured } from "../../ai/lib/ai-service";
import type { Highlight } from "../../annotations/lib/annotation-types";
import { useAnchoredMenuPosition } from "../hooks/useAnchoredMenuPosition";
import { HIGHLIGHT_COLORS } from "../lib/highlight-renderer";
import type { SelectionOverlayRect } from "../lib/selection-overlay";

type ReaderAnnotationMenuProps = {
  /** Anchor of the tapped highlight/underline, or null when nothing is active. */
  anchorRect: SelectionOverlayRect | null;
  activeColor: Highlight["color"];
  onRecolor: (color: Highlight["color"]) => void;
  onCopy: () => Promise<void> | void;
  onAddNote: () => void;
  onLookUp: () => void;
  onAskAI: () => void;
  onRemove: () => void;
};

const COLOR_OPTIONS: Highlight["color"][] = ["yellow", "green", "blue", "pink"];

/** Hairline divider separating action groups within the bar. */
function MenuDivider() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

/**
 * Actions for an existing mark. Tapping a highlight or underline in the reader
 * anchors this over it: recolor (the current colour is ringed), add a note, look
 * up, copy, ask AI, and remove.
 */
export function ReaderAnnotationMenu({
  anchorRect,
  activeColor,
  onRecolor,
  onCopy,
  onAddNote,
  onLookUp,
  onAskAI,
  onRemove,
}: ReaderAnnotationMenuProps) {
  const { containerRef, menuRef, position } = useAnchoredMenuPosition(anchorRect);
  const [copied, setCopied] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const copyResetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setAiConfigured(isAIConfigured());
  }, [anchorRect]);

  useEffect(() => {
    setCopied(false);
    if (copyResetTimeoutRef.current != null) {
      window.clearTimeout(copyResetTimeoutRef.current);
      copyResetTimeoutRef.current = null;
    }
  }, [anchorRect]);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current != null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  if (!anchorRect) return null;

  const actionButtonClass =
    "rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg focus-visible:ring-fg";

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
        {COLOR_OPTIONS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Recolor ${color}`}
            title={color}
            onClick={() => onRecolor(color)}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-fg/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
          >
            <span
              className={cn(
                "block h-4 w-4 rounded-full ring-1 ring-inset",
                color === activeColor ? "ring-fg" : "ring-black/15 dark:ring-white/20",
              )}
              style={{ backgroundColor: HIGHLIGHT_COLORS[color] }}
            />
          </button>
        ))}

        <MenuDivider />
        <IconButton
          label="Add a note"
          title="Add a note"
          size="sm"
          onClick={onAddNote}
          className={actionButtonClass}
          icon={<NotePencil size={14} weight="regular" aria-hidden="true" />}
        />
        <IconButton
          label="Look up"
          title="Look up"
          size="sm"
          onClick={onLookUp}
          className={actionButtonClass}
          icon={<BookOpen size={14} weight="regular" aria-hidden="true" />}
        />
        <IconButton
          label={copied ? "Copied" : "Copy"}
          title={copied ? "Copied" : "Copy"}
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
        {aiConfigured && (
          <IconButton
            label="Ask AI about this"
            title="Ask AI about this"
            size="sm"
            onClick={onAskAI}
            className={actionButtonClass}
            icon={<ChatCircleDots size={14} weight="regular" aria-hidden="true" />}
          />
        )}

        <MenuDivider />
        <IconButton
          label="Remove"
          title="Remove"
          size="sm"
          onClick={onRemove}
          className={actionButtonClass}
          icon={<Trash size={14} weight="regular" aria-hidden="true" />}
        />
      </div>
    </div>
  );
}
