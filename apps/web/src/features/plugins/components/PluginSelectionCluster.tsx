/**
 * Plugin-contributed actions inside the reader's selection/annotation menus.
 * Placement is user-owned (docs/plugin-system.md §7): promoted actions render
 * inline (capped), everything else lives behind one quiet overflow trigger.
 * Renders nothing when no plugin contributes — the menus stay untouched.
 */
import { PuzzlePiece } from "@phosphor-icons/react";
import { useState } from "react";
import { useAtomValue } from "jotai";
import { IconButton, Popover, Tooltip } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { renderPluginIcon } from "../lib/plugin-icons";
import { runPluginContribution } from "../lib/run-result";
import type { RegisteredSelectionAction, SelectionActionInput } from "../lib/plugin-types";
import {
  SELECTION_PIN_LIMIT,
  pluginPlacementAtom,
  selectionActionsAtom,
} from "../state/plugin-store";

/** Matches the quiet ghost-button styling of the hosting menus. */
const actionButtonClass =
  "rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg focus-visible:ring-fg";

type PluginSelectionClusterProps = {
  /** The current selection context, or null when the menu has no target. */
  input: SelectionActionInput | null;
  /** Rendered before the cluster when at least one action exists. */
  divider?: React.ReactNode;
};

export function PluginSelectionCluster({ input, divider }: PluginSelectionClusterProps) {
  const { t } = useTranslation("plugins");
  const actions = useAtomValue(selectionActionsAtom);
  const placement = useAtomValue(pluginPlacementAtom);
  const [overflowOpen, setOverflowOpen] = useState(false);

  if (actions.length === 0 || !input) return null;

  const pinnedKeys = placement.selection.slice(0, SELECTION_PIN_LIMIT);
  const pinned = pinnedKeys
    .map((key) => actions.find((action) => action.key === key))
    .filter((action): action is RegisteredSelectionAction => action !== undefined);
  const overflow = actions.filter((action) => !pinnedKeys.includes(action.key));

  const run = (action: RegisteredSelectionAction) => {
    setOverflowOpen(false);
    void runPluginContribution(action.pluginId, action.pluginName, () => action.run(input));
  };

  return (
    <>
      {divider}
      {pinned.map((action) => (
        <Tooltip key={action.key} content={action.title} side="top">
          <IconButton
            label={action.title}
            size="sm"
            onClick={() => run(action)}
            className={actionButtonClass}
            icon={renderPluginIcon(action.icon, 14)}
          />
        </Tooltip>
      ))}
      {overflow.length > 0 && (
        <Popover
          open={overflowOpen}
          onOpenChange={setOverflowOpen}
          align="right"
          triggerLabel={t("menu.actions")}
          triggerTooltip={t("menu.actions")}
          triggerTooltipSide="top"
          trigger={
            <span
              className={`flex h-7 w-7 items-center justify-center ${actionButtonClass}`}
            >
              <PuzzlePiece size={14} weight="regular" aria-hidden="true" />
            </span>
          }
          panelClassName="max-h-64 w-52 overflow-y-auto p-1"
        >
          <ul className="flex flex-col">
            {overflow.map((action) => (
              <li key={action.key}>
                <button
                  type="button"
                  onClick={() => run(action)}
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
