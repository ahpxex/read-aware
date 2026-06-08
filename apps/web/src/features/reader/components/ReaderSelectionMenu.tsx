import { Check, Copy, Highlighter, NotePencil, ChatCircleDots } from "@phosphor-icons/react";
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

export function ReaderSelectionMenu({
  selection,
  onCopy,
  onSetAppearance,
  onHighlight,
  onAddNote,
  onAskAI,
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

  const actionButtonClass =
    "rounded-full text-stone-500 hover:bg-stone-100 hover:text-stone-950 focus-visible:ring-stone-950";

  return (
    <div ref={containerRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <div
        ref={menuRef}
        className="pointer-events-auto absolute flex items-center gap-0.5 rounded-full border border-stone-200/90 bg-stone-50/96 p-1 shadow-[0_12px_32px_rgba(28,25,23,0.10)] backdrop-blur-sm"
        style={position}
      >
        {showColors ? (
          <>
            {COLOR_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={`Highlight ${option.label}`}
                title={option.label}
                onClick={() => handleColorSelect(option.value)}
                className="flex h-7 w-7 items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950"
              >
                <span
                  className="block h-4 w-4 rounded-full border border-black/10"
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
              className={cn(
                actionButtonClass,
                copied && "bg-stone-100 text-stone-950",
              )}
              icon={
                copied ? (
                  <Check size={14} weight="regular" aria-hidden="true" />
                ) : (
                  <Copy size={14} weight="regular" aria-hidden="true" />
                )
              }
            />
            <IconButton
              label="Highlight selection"
              title="Highlight selection"
              size="sm"
              onClick={handleHighlightClick}
              className={cn(
                actionButtonClass,
                selection.appearance === "highlight" && "bg-stone-100 text-stone-950",
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
                selection.appearance === "note" && "bg-stone-100 text-stone-950",
              )}
              icon={<NotePencil size={14} weight="regular" aria-hidden="true" />}
            />
            {aiConfigured && (
              <IconButton
                label="Ask AI about this"
                title="Ask AI about this"
                size="sm"
                onClick={handleAskAI}
                className={cn(
                  actionButtonClass,
                  "text-indigo-500 hover:text-indigo-600 hover:bg-indigo-50",
                )}
                icon={<ChatCircleDots size={14} weight="regular" aria-hidden="true" />}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
