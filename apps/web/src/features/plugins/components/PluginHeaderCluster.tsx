/**
 * Plugin-contributed icon buttons for a header bar (shelf or reader).
 *
 * Placement is user-owned (docs/plugin-system.md §7): pinned actions render as
 * buttons (popup ones as anchored Popovers, page ones push the plugin page);
 * everything else collapses behind one overflow trigger whose entries open in
 * the Dialog host. Renders nothing when no plugin contributes to this surface.
 */
import { PuzzlePiece } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { IconButton, Popover, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { openHeaderActionDialog } from "../lib/open-header-action";
import { renderPluginIcon } from "../lib/plugin-icons";
import { showPluginToast } from "../lib/plugin-toast";
import type {
  HeaderActionInput,
  PluginHeaderSurface,
  PluginView,
  RegisteredHeaderAction,
} from "../lib/plugin-types";
import {
  HEADER_PIN_LIMIT,
  headerActionsAtom,
  pluginPlacementAtom,
} from "../state/plugin-store";
import { PluginViewRenderer } from "./PluginViewRenderer";

type PluginHeaderClusterProps = {
  surface: PluginHeaderSurface;
  /** Reader surface: the open book, forwarded to `view(input)`. */
  input?: HeaderActionInput;
  /** Shelf surface: navigates to a pinned action's full page. */
  onOpenPage?: (key: string) => void;
  /** Extra classes on each trigger (e.g. pointer-events fixes in overlays). */
  buttonClassName?: string;
};

export function PluginHeaderCluster({
  surface,
  input = {},
  onOpenPage,
  buttonClassName,
}: PluginHeaderClusterProps) {
  const { t } = useTranslation("plugins");
  const allActions = useAtomValue(headerActionsAtom);
  const placement = useAtomValue(pluginPlacementAtom);
  const [overflowOpen, setOverflowOpen] = useState(false);

  const actions = allActions.filter((action) => action.surface === surface);
  if (actions.length === 0) return null;

  const pinnedKeys = (surface === "shelf" ? placement.shelfHeader : placement.readerHeader).slice(
    0,
    HEADER_PIN_LIMIT,
  );
  const pinned = pinnedKeys
    .map((key) => actions.find((action) => action.key === key))
    .filter((action): action is RegisteredHeaderAction => action !== undefined);
  const overflow = actions.filter((action) => !pinnedKeys.includes(action.key));

  const opensPage = (action: RegisteredHeaderAction) =>
    surface === "shelf" && action.presentation === "page";

  return (
    <>
      {pinned.map((action) =>
        opensPage(action) ? (
          <Tooltip key={action.key} content={action.title} side="bottom">
            <IconButton
              label={action.title}
              size="sm"
              onClick={() => onOpenPage?.(action.key)}
              className={cn(
                "relative text-fg-muted hover:text-fg before:absolute before:-inset-1 before:content-['']",
                buttonClassName,
              )}
              icon={renderPluginIcon(action.icon, 16)}
            />
          </Tooltip>
        ) : (
          <PluginHeaderPopupButton
            key={action.key}
            action={action}
            input={input}
            buttonClassName={buttonClassName}
          />
        ),
      )}
      {overflow.length > 0 && (
        <Popover
          open={overflowOpen}
          onOpenChange={setOverflowOpen}
          align="right"
          triggerLabel={t("menu.actions")}
          triggerTooltip={t("menu.actions")}
          className={buttonClassName}
          trigger={
            <span className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:text-fg">
              <PuzzlePiece size={16} weight="regular" aria-hidden="true" />
            </span>
          }
          panelClassName="max-h-72 w-56 overflow-y-auto p-1"
        >
          <ul className="flex flex-col">
            {overflow.map((action) => (
              <li key={action.key}>
                <button
                  type="button"
                  onClick={() => {
                    setOverflowOpen(false);
                    if (opensPage(action)) onOpenPage?.(action.key);
                    else void openHeaderActionDialog(action, input);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg transition-colors hover:bg-fg/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
                >
                  <span className="text-fg-muted">{renderPluginIcon(action.icon, 15)}</span>
                  <span className="min-w-0 flex-1 truncate">{action.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </>
  );
}

/**
 * One plugin header action as an inline button: page actions navigate, popup
 * actions open an anchored Popover. The menu-config surfaces render these
 * directly; the legacy cluster above composes them too.
 */
export function PluginHeaderItem({
  action,
  input = {},
  onOpenPage,
  buttonClassName,
}: {
  action: RegisteredHeaderAction;
  input?: HeaderActionInput;
  onOpenPage?: (key: string) => void;
  buttonClassName?: string;
}) {
  if (action.surface === "shelf" && action.presentation === "page") {
    return (
      <Tooltip content={action.title} side="bottom">
        <IconButton
          label={action.title}
          size="sm"
          onClick={() => onOpenPage?.(action.key)}
          className={cn(
            "relative text-fg-muted hover:text-fg before:absolute before:-inset-1 before:content-['']",
            buttonClassName,
          )}
          icon={renderPluginIcon(action.icon, 16)}
        />
      </Tooltip>
    );
  }
  return (
    <PluginHeaderPopupButton action={action} input={input} buttonClassName={buttonClassName} />
  );
}

/** A pinned popup action: anchored Popover whose view loads when opened. */
function PluginHeaderPopupButton({
  action,
  input,
  buttonClassName,
}: {
  action: RegisteredHeaderAction;
  input: HeaderActionInput;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PluginView | null>(null);

  useEffect(() => {
    if (!open) {
      setView(null);
      return;
    }
    let cancelled = false;
    Promise.resolve(action.view(input))
      .then((next) => {
        if (!cancelled) setView(next);
      })
      .catch((error) => {
        console.error(`[plugins] header action "${action.key}" failed`, error);
        showPluginToast(
          `${action.pluginName}: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (!cancelled) setOpen(false);
      });
    return () => {
      cancelled = true;
    };
    // The view is fetched fresh each open; `input` identity churn is irrelevant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, action]);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="right"
      triggerLabel={action.title}
      triggerTooltip={action.title}
      className={buttonClassName}
      trigger={
        <span className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:text-fg">
          {renderPluginIcon(action.icon, 16)}
        </span>
      }
      panelClassName="w-80 max-w-[calc(100vw-2rem)] p-3"
    >
      <PluginViewRenderer view={view} onClose={() => setOpen(false)} className="max-h-80" />
    </Popover>
  );
}
