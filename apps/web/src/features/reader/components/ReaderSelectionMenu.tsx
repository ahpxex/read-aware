import {
  CaretLeft,
  ChatCircleDots,
  Check,
  Copy,
  Highlighter,
  NotePencil,
} from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconButton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { isAIConfigured } from "../../ai/lib/ai-service";
import type { Highlight } from "../../annotations/lib/annotation-types";
import type { ReaderSelectionAppearance, ReaderSelectionState } from "../lib/selection-overlay";
import { HIGHLIGHT_COLORS } from "../lib/highlight-renderer";

type ReaderSelectionMenuProps = {
  selection: ReaderSelectionState | null;
  onCopy: () => Promise<void> | void;
  onSetAppearance: (appearance: ReaderSelectionAppearance) => void;
  onHighlight?: (color: Highlight["color"]) => void;
  onAddNote?: () => void;
  onAskAI?: () => void;
  /** When false (e.g. fixed-layout PDF) only the copy action is offered. */
  allowAnnotations?: boolean;
};

type MenuPosition = {
  left: number;
  top: number;
};

const EDGE_PADDING = 10;
const MENU_OFFSET = 12;

const COLOR_OPTIONS: { value: Highlight["color"]; label: string }[] = [
  { value: "yellow", label: "Yellow" },
  { value: "green", label: "Green" },
  { value: "blue", label: "Blue" },
  { value: "pink", label: "Pink" },
];

/** Hairline divider separating action groups within the bar. */
function MenuDivider() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

export function ReaderSelectionMenu({
  selection,
  onCopy,
  onSetAppearance,
  onHighlight,
  onAddNote,
  onAskAI,
  allowAnnotations = true,
}: ReaderSelectionMenuProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const [position, setPosition] = useState<MenuPosition>({ left: EDGE_PADDING, top: EDGE_PADDING });
  const [copied, setCopied] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [showColors, setShowColors] = useState(false);

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
    setShowColors(false);
    if (copyResetTimeoutRef.current != null) {
      window.clearTimeout(copyResetTimeoutRef.current);
      copyResetTimeoutRef.current = null;
    }
  }, [selection?.cfiRange, selection?.text]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const menu = menuRef.current;
    const anchorRect = selection?.anchorRect;
    if (!container || !menu || !anchorRect) return;

    const containerWidth = container.offsetWidth;
    const containerHeight = container.offsetHeight;
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const anchorCenterX = anchorRect.left + anchorRect.width / 2;
    const preferredTop = anchorRect.top - menuHeight - MENU_OFFSET;
    const fallbackTop = anchorRect.top + anchorRect.height + MENU_OFFSET;

    const left = Math.min(
      Math.max(EDGE_PADDING, anchorCenterX - menuWidth / 2),
      Math.max(EDGE_PADDING, containerWidth - menuWidth - EDGE_PADDING),
    );

    const top =
      preferredTop >= EDGE_PADDING
        ? preferredTop
        : Math.min(
            fallbackTop,
            Math.max(EDGE_PADDING, containerHeight - menuHeight - EDGE_PADDING),
          );

    setPosition({ left, top });
  }, [selection, showColors]);

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

  function handleHighlightClick() {
    onSetAppearance("highlight");
    setShowColors(true);
  }

  function handleColorSelect(color: Highlight["color"]) {
    onHighlight?.(color);
    setShowColors(false);
  }

  function handleAddNote() {
    onSetAppearance("note");
    onAddNote?.();
  }

  function handleAskAI() {
    onAskAI?.();
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
        {showColors ? (
          <>
            <IconButton
              label="Back"
              title="Back"
              size="sm"
              onClick={() => setShowColors(false)}
              className={actionButtonClass}
              icon={<CaretLeft size={14} weight="regular" aria-hidden="true" />}
            />
            <MenuDivider />
            {COLOR_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={`Highlight ${option.label}`}
                title={option.label}
                onClick={() => handleColorSelect(option.value)}
                className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-fg/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
              >
                <span
                  className="block h-4 w-4 rounded-full ring-1 ring-inset ring-black/15 dark:ring-white/20"
                  style={{ backgroundColor: HIGHLIGHT_COLORS[option.value] }}
                />
              </button>
            ))}
          </>
        ) : (
          <>
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
                  label="Highlight selection"
                  title="Highlight selection"
                  size="sm"
                  onClick={handleHighlightClick}
                  className={cn(
                    actionButtonClass,
                    selection.appearance === "highlight" && "bg-fill-strong text-fg",
                  )}
                  icon={<Highlighter size={14} weight="regular" aria-hidden="true" />}
                />
                <IconButton
                  label="Add a note"
                  title="Add a note"
                  size="sm"
                  onClick={handleAddNote}
                  className={cn(
                    actionButtonClass,
                    selection.appearance === "note" && "bg-fill-strong text-fg",
                  )}
                  icon={<NotePencil size={14} weight="regular" aria-hidden="true" />}
                />
                {aiConfigured && (
                  <>
                    <MenuDivider />
                    <IconButton
                      label="Ask AI about this"
                      title="Ask AI about this"
                      size="sm"
                      onClick={handleAskAI}
                      className={actionButtonClass}
                      icon={<ChatCircleDots size={14} weight="regular" aria-hidden="true" />}
                    />
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
