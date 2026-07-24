/**
 * Plugin-contributed actions inside the reader's selection/annotation menus.
 * Placement is user-owned (docs/plugin-system.md §7): promoted actions render
 * inline, everything else lives behind one quiet overflow trigger.
 * Renders nothing when no plugin contributes — the menus stay untouched.
 */
import { PuzzlePiece } from "@phosphor-icons/react";
import { useAtomValue } from "jotai";
import { DropdownMenu, IconButton, Tooltip } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import {
  menuConfigAtom,
  pluginMenuId,
  resolveSurfaceLayout,
} from "../../menus/state/menu-config";
import { renderPluginIcon } from "../lib/plugin-icons";
import { runPluginContribution } from "../lib/run-result";
import type { RegisteredSelectionAction, SelectionActionInput } from "../lib/plugin-types";
import { selectionActionsAtom } from "../state/plugin-store";

/** Matches the quiet ghost-button styling of the hosting menus. */
const actionButtonClass =
  "rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg focus-visible:ring-fg";

type PluginSelectionClusterProps = {
  /** The current selection context, or null when the menu has no target. */
  input: SelectionActionInput | null;
  /** Rendered before the cluster when at least one action exists. */
  divider?: React.ReactNode;
  /** Direction for the overflow menu; bottom-anchored toolbars open upward. */
  overflowSide?: "top" | "bottom";
};

export function PluginSelectionCluster({
  input,
  divider,
  overflowSide = "bottom",
}: PluginSelectionClusterProps) {
  const { t } = useTranslation("plugins");
  const actions = useAtomValue(selectionActionsAtom);
  const menuConfig = useAtomValue(menuConfigAtom);

  if (actions.length === 0 || !input) return null;

  const actionById = new Map(actions.map((action) => [pluginMenuId(action.key), action]));
  const layout = resolveSurfaceLayout(
    menuConfig.selection,
    [...actionById.keys()],
    {
      defaultVisibleIds: actions
        .filter((action) => action.role === "lookup")
        .map((action) => pluginMenuId(action.key)),
    },
  );
  const inline = layout.visible
    .map((id) => actionById.get(id))
    .filter((action): action is RegisteredSelectionAction => action !== undefined);
  const overflow = layout.overflow
    .map((id) => actionById.get(id))
    .filter((action): action is RegisteredSelectionAction => action !== undefined);

  const run = (action: RegisteredSelectionAction) => {
    void runPluginContribution(
      action.pluginId,
      action.pluginName,
      () => action.run(input),
      { presentation: action.presentation },
    );
  };

  return (
    <>
      {divider}
      {inline.map((action) => (
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
        <DropdownMenu
          align="right"
          side={overflowSide}
          triggerLabel={t("menu.actions")}
          trigger={
            <span
              className={`flex h-7 w-7 items-center justify-center ${actionButtonClass}`}
            >
              <PuzzlePiece size={14} weight="regular" aria-hidden="true" />
            </span>
          }
          items={overflow.map((action) => ({
            label: action.title,
            icon: renderPluginIcon(action.icon, 15),
            onClick: () => run(action),
          }))}
        />
      )}
    </>
  );
}
