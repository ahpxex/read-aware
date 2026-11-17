/**
 * The shelf header's items as header entries — each one an inline button and
 * its "More" menu row, built once — in the user's arrangement. AppHeader
 * decides how many fit inline; the rest, and everything the user tucked away,
 * become rows of the dots menu. Phone widths list them all in that menu.
 *
 * Items are actions (search, import, the shelf view, settings), destinations
 * the primary navigation does not hold (see `resolveMenuLayouts`) and shelf
 * plugin contributions.
 */
import type { ReactNode } from "react";
import { FolderPlus, GearSix, MagnifyingGlass, Plus, SlidersHorizontal, type Icon } from "@phosphor-icons/react";
import { IconButton, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useAtomValue } from "jotai";
import { useTranslation } from "../../../i18n";
import type { TopNav } from "../../../state/ui";
import { isPluginPage, pluginMenuId, useMenuLayouts } from "../../menus";
import {
  actionEnabled,
  actionVisible,
  contributionText,
  headerActionsAtom,
  openHeaderActionDialog,
  PluginHeaderItem,
  renderPluginIcon,
  type RegisteredHeaderAction,
} from "../../plugins";
import type { HeaderActionEntry } from "../lib/header-actions";
import { useDestination, type Destination } from "./useDestination";

export const headerIconButtonClass =
  "relative text-fg-muted hover:text-fg before:absolute before:-inset-1 before:content-['']";

type ShelfHeaderOptions = {
  activeTopNav: TopNav;
  isImporting: boolean;
  onImport: () => void;
  onImportFolder: () => void;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  onTopNavChange: (topNav: TopNav) => void;
  /** The shelf view widget, when the current surface has one. */
  viewControl?: ReactNode;
};

type CoreAction = { label: string; tooltip?: string; Icon: Icon; run: () => void; disabled?: boolean };

export type ShelfHeaderEntries = {
  /** The user's inline items, in order. */
  visible: HeaderActionEntry[];
  /** The items the user placed in the "More" menu. */
  overflow: HeaderActionEntry[];
};

export function useShelfHeaderEntries({
  activeTopNav,
  isImporting,
  onImport,
  onImportFolder,
  onOpenSettings,
  onOpenSearch,
  onTopNavChange,
  viewControl,
}: ShelfHeaderOptions): ShelfHeaderEntries {
  const { t } = useTranslation("nav");
  const { t: tSettings } = useTranslation("settings");
  const layout = useMenuLayouts().shelfHeader;
  const describeDestination = useDestination();
  const headerActions = useAtomValue(headerActionsAtom);
  // Plugin buttons live on the shelf only (docs/plugins/plugin-system.md §5);
  // plugin PAGES are destinations and stay reachable from every surface.
  const onShelf = activeTopNav === "shelf";

  const coreActions: Record<string, CoreAction> = {
    "core:search": { label: t("header.search"), Icon: MagnifyingGlass, run: onOpenSearch },
    "core:import": {
      label: t("header.import"),
      tooltip: isImporting ? t("header.importing") : undefined,
      Icon: Plus,
      run: onImport,
      disabled: isImporting,
    },
    "core:importFolder": {
      label: t("header.importFolder"),
      Icon: FolderPlus,
      run: onImportFolder,
      disabled: isImporting,
    },
    "core:settings": { label: t("header.settings"), Icon: GearSix, run: onOpenSettings },
  };

  const coreActionEntry = (id: string, action: CoreAction): HeaderActionEntry => ({
    id,
    inline: (
      <Tooltip content={action.tooltip ?? action.label} side="bottom">
        <IconButton
          label={action.label}
          size="sm"
          onClick={action.run}
          disabled={action.disabled}
          className={headerIconButtonClass}
          icon={<action.Icon size={16} weight="regular" aria-hidden="true" />}
        />
      </Tooltip>
    ),
    overflow: {
      id,
      label: action.tooltip ?? action.label,
      icon: <action.Icon size={16} weight="regular" aria-hidden="true" />,
      run: action.run,
      disabled: action.disabled,
    },
  });

  const destinationEntry = (destination: Destination): HeaderActionEntry => {
    const active = activeTopNav === destination.topNav;
    // Pressing the page you are on returns to the shelf, like a toggle.
    const run = () => onTopNavChange(active ? "shelf" : destination.topNav);
    return {
      id: destination.id,
      inline: (
        <Tooltip content={destination.label} side="bottom">
          <IconButton
            label={destination.label}
            size="sm"
            aria-pressed={active}
            onClick={run}
            className={cn(
              "relative before:absolute before:-inset-1 before:content-['']",
              active ? "text-fg" : "text-fg-muted hover:text-fg",
            )}
            icon={destination.icon(16, active)}
          />
        </Tooltip>
      ),
      overflow: { id: destination.id, label: destination.label, icon: destination.icon(16, active), run },
    };
  };

  const pluginEntry = (id: string, action: RegisteredHeaderAction): HeaderActionEntry => ({
    id,
    inline: <PluginHeaderItem action={action} onOpenPage={(key) => onTopNavChange(`plugin:${key}`)} />,
    overflow: {
      id,
      label: contributionText(action.title),
      disabled: !actionEnabled(action),
      checked: action.state?.checked,
      icon: renderPluginIcon(action.icon, 16),
      run: () => {
        if (isPluginPage(action)) onTopNavChange(`plugin:${action.key}`);
        else void openHeaderActionDialog(action, {});
      },
    },
  });

  const entryFor = (id: string): HeaderActionEntry | null => {
    const coreAction = coreActions[id];
    if (coreAction) return coreActionEntry(id, coreAction);
    if (id === "core:viewControl") {
      if (!viewControl) return null;
      const label = tSettings("menus.items.viewControl");
      const icon = <SlidersHorizontal size={16} weight="regular" aria-hidden="true" />;
      return { id, inline: viewControl, overflow: { id, label, icon, node: viewControl } };
    }
    if (id.startsWith("plugin:")) {
      const action = headerActions.find((entry) => pluginMenuId(entry.key) === id);
      if (!action || !actionVisible(action)) return null;
      if (!onShelf && !isPluginPage(action)) return null;
      return pluginEntry(id, action);
    }
    const destination = describeDestination(id);
    return destination ? destinationEntry(destination) : null;
  };

  const entries = (ids: readonly string[]) =>
    ids.map(entryFor).filter((entry): entry is HeaderActionEntry => entry !== null);
  return { visible: entries(layout.visible), overflow: entries(layout.overflow) };
}
