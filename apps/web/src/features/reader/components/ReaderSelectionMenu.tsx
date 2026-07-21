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
import { IconButton, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { useAskAiEnabled } from "../../ai/hooks/useAskAiEnabled";
import { PluginSelectionCluster } from "../../plugins/components/PluginSelectionCluster";
import type { SelectionActionInput } from "../../plugins/lib/plugin-types";
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
  /** Selection context for plugin-contributed actions (null hides them). */
  pluginInput?: SelectionActionInput | null;
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
  pluginInput = null,
}: ReaderSelectionMenuProps) {
  const { t } = useTranslation("reader");
  const { containerRef, menuRef, position } = useAnchoredMenuPosition(selection?.anchorRect);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const askEnabled = useAskAiEnabled();

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
        className="ra-motion-overlay-pop pointer-events-auto absolute flex max-w-[calc(100vw-1.25rem)] flex-wrap items-center gap-0.5 rounded-lg border border-border bg-[var(--ra-main-surface-color)] p-1 shadow-[0_4px_16px_-6px_rgba(28,25,23,0.25)]"
        style={position}
      >
        <Tooltip content={copied ? t("menu.copied") : t("menu.copySelection")} side="top">
          <IconButton
            label={copied ? t("menu.copied") : t("menu.copySelection")}
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
        </Tooltip>

        {allowAnnotations && (
          <>
            <MenuDivider />
            <Tooltip content={t("menu.highlight")} side="top">
              <IconButton
                label={t("menu.highlight")}
                size="sm"
                onClick={() => onHighlight?.()}
                className={actionButtonClass}
                icon={<Highlighter size={14} weight="regular" aria-hidden="true" />}
              />
            </Tooltip>
            <Tooltip content={t("menu.underline")} side="top">
              <IconButton
                label={t("menu.underline")}
                size="sm"
                onClick={() => onUnderline?.()}
                className={actionButtonClass}
                icon={<TextUnderline size={14} weight="regular" aria-hidden="true" />}
              />
            </Tooltip>
            <Tooltip content={t("menu.addNote")} side="top">
              <IconButton
                label={t("menu.addNote")}
                size="sm"
                onClick={() => onAddNote?.()}
                className={actionButtonClass}
                icon={<NotePencil size={14} weight="regular" aria-hidden="true" />}
              />
            </Tooltip>

            <MenuDivider />
            <Tooltip content={t("menu.lookUp")} side="top">
              <IconButton
                label={t("menu.lookUp")}
                size="sm"
                onClick={() => onLookUp?.()}
                className={actionButtonClass}
                icon={<BookOpen size={14} weight="regular" aria-hidden="true" />}
              />
            </Tooltip>
            {askEnabled && (
              <Tooltip content={t("menu.askAi")} side="top">
                <IconButton
                  label={t("menu.askAi")}
                  size="sm"
                  onClick={() => onAskAI?.()}
                  className={actionButtonClass}
                  icon={<ChatCircleDots size={14} weight="regular" aria-hidden="true" />}
                />
              </Tooltip>
            )}
          </>
        )}
        <PluginSelectionCluster input={pluginInput} divider={<MenuDivider />} />
      </div>
    </div>
  );
}
