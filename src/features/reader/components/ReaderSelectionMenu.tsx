import { Check, Copy, Highlighter, NotePencil, ChatCircleDots } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconButton } from "../../../components";
import { cn } from "../../../components/lib/cn";
import { isAIConfigured } from "../../ai/lib/ai-service";
import type { ReaderSelectionAppearance, ReaderSelectionState } from "../lib/selection-overlay";

type ReaderSelectionMenuProps = {
  selection: ReaderSelectionState | null;
  onCopy: () => Promise<void> | void;
  onSetAppearance: (appearance: ReaderSelectionAppearance) => void;
  onHighlight?: () => void;
  onAddNote?: () => void;
  onAskAI?: () => void;
};

type MenuPosition = {
  left: number;
  top: number;
};

const EDGE_PADDING = 10;
const MENU_OFFSET = 12;

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

  useEffect(() => {
    // Check AI config on mount and when selection changes
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
  }, [selection]);

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

  function handleHighlight() {
    onSetAppearance("highlight");
    onHighlight?.();
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
          onClick={handleHighlight}
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
      </div>
    </div>
  );
}
