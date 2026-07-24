import {
  ChatCircleDots,
  Check,
  Copy,
  Highlighter,
  NotePencil,
  TextUnderline,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import { IconButton, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { useAskAiEnabled } from "../../ai/hooks/useAskAiEnabled";
import { MenuOverflow, type MenuOverflowEntry } from "../../menus/components/MenuOverflow";
import { coreMenuMeta } from "../../menus/lib/menu-registry";
import {
  CORE_MENU_DEFAULTS,
  menuConfigAtom,
  pluginMenuId,
  resolveSurfaceLayout,
} from "../../menus/state/menu-config";
import { renderPluginIcon } from "../../plugins/lib/plugin-icons";
import { runPluginContribution } from "../../plugins/lib/run-result";
import type { SelectionActionInput } from "../../plugins/lib/plugin-types";
import { selectionActionsAtom } from "../../plugins/state/plugin-store";
import { useAnchoredMenuPosition } from "../hooks/useAnchoredMenuPosition";
import type { ReaderSelectionState } from "../lib/selection-overlay";

type ReaderSelectionMenuProps = {
  selection: ReaderSelectionState | null;
  onCopy: () => Promise<void> | void;
  /** One-click highlight (default color) — applied immediately, no extra step. */
  onHighlight?: () => void;
  onUnderline?: () => void;
  onAddNote?: () => void;
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

/**
 * The selection action bar — item set, order, and overflow are user-arranged
 * (settings → Menus), core and plugin actions interleaved alike.
 */
export function ReaderSelectionMenu({
  selection,
  onCopy,
  onHighlight,
  onUnderline,
  onAddNote,
  onAskAI,
  allowAnnotations = true,
  pluginInput = null,
}: ReaderSelectionMenuProps) {
  const { t } = useTranslation("reader");
  const { t: tMenus } = useTranslation("settings");
  const { containerRef, menuRef, position } = useAnchoredMenuPosition(selection?.anchorRect);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const askEnabled = useAskAiEnabled();
  const menuConfig = useAtomValue(menuConfigAtom);
  const pluginActions = useAtomValue(selectionActionsAtom);

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

  // Availability gates: fixed-layout books offer copy only; Ask AI needs a key.
  const availableCore = CORE_MENU_DEFAULTS.selection.filter((id) => {
    if (!allowAnnotations && id !== "core:copy") return false;
    if (id === "core:askAI" && !askEnabled) return false;
    return true;
  });
  const availablePluginIds = pluginInput
    ? pluginActions.map((action) => pluginMenuId(action.key))
    : [];
  const layout = resolveSurfaceLayout(
    menuConfig.selection,
    [...availableCore, ...availablePluginIds],
    {
      defaultVisibleIds: pluginInput
        ? pluginActions
            .filter((action) => action.role === "lookup")
            .map((action) => pluginMenuId(action.key))
        : [],
    },
  );

  const coreNodes: Record<string, ReactNode> = {
    "core:copy": (
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
    ),
    "core:highlight": (
      <Tooltip content={t("menu.highlight")} side="top">
        <IconButton
          label={t("menu.highlight")}
          size="sm"
          onClick={() => onHighlight?.()}
          className={actionButtonClass}
          icon={<Highlighter size={14} weight="regular" aria-hidden="true" />}
        />
      </Tooltip>
    ),
    "core:underline": (
      <Tooltip content={t("menu.underline")} side="top">
        <IconButton
          label={t("menu.underline")}
          size="sm"
          onClick={() => onUnderline?.()}
          className={actionButtonClass}
          icon={<TextUnderline size={14} weight="regular" aria-hidden="true" />}
        />
      </Tooltip>
    ),
    "core:addNote": (
      <Tooltip content={t("menu.addNote")} side="top">
        <IconButton
          label={t("menu.addNote")}
          size="sm"
          onClick={() => onAddNote?.()}
          className={actionButtonClass}
          icon={<NotePencil size={14} weight="regular" aria-hidden="true" />}
        />
      </Tooltip>
    ),
    "core:askAI": (
      <Tooltip content={t("menu.askAi")} side="top">
        <IconButton
          label={t("menu.askAi")}
          size="sm"
          onClick={() => onAskAI?.()}
          className={actionButtonClass}
          icon={<ChatCircleDots size={14} weight="regular" aria-hidden="true" />}
        />
      </Tooltip>
    ),
  };

  const coreRun: Record<string, (() => void) | undefined> = {
    "core:copy": () => void handleCopy(),
    "core:highlight": onHighlight,
    "core:underline": onUnderline,
    "core:addNote": onAddNote,
    "core:askAI": onAskAI,
  };
  const overflowEntries = layout.overflow
    .map((id): MenuOverflowEntry | null => {
      if (id.startsWith("plugin:")) {
        const action = pluginActions.find((entry) => pluginMenuId(entry.key) === id);
        if (!action || !pluginInput) return null;
        return {
          id,
          label: action.title,
          icon: renderPluginIcon(action.icon, 15),
          run: () =>
            void runPluginContribution(
              action.pluginId,
              action.pluginName,
              () => action.run(pluginInput),
              { presentation: action.presentation },
            ),
        };
      }
      const meta = coreMenuMeta("selection", id);
      const run = coreRun[id];
      if (!meta || !run) return null;
      return {
        id,
        label: String(tMenus(`menus.items.${meta.labelKey}` as never)),
        icon: <meta.Icon size={15} weight="regular" aria-hidden="true" />,
        run,
      };
    })
    .filter((entry): entry is MenuOverflowEntry => entry !== null);

  let renderedPluginBoundary = false;

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
        {layout.visible.map((id) => {
          if (id.startsWith("plugin:")) {
            const action = pluginActions.find((entry) => pluginMenuId(entry.key) === id);
            if (!action || !pluginInput) return null;
            const divider = !renderedPluginBoundary ? <MenuDivider /> : null;
            renderedPluginBoundary = true;
            return (
              <span key={id} className="contents">
                {divider}
                <Tooltip content={action.title} side="top">
                  <IconButton
                    label={action.title}
                    size="sm"
                    onClick={() =>
                      void runPluginContribution(
                        action.pluginId,
                        action.pluginName,
                        () => action.run(pluginInput),
                        { presentation: action.presentation },
                      )
                    }
                    className={actionButtonClass}
                    icon={renderPluginIcon(action.icon, 14)}
                  />
                </Tooltip>
              </span>
            );
          }
          const node = coreNodes[id];
          return node ? <span key={id} className="contents">{node}</span> : null;
        })}
        <MenuOverflow entries={overflowEntries} size="sm" />
      </div>
    </div>
  );
}
