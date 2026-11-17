/**
 * Destinations — the pages the app can land on — described once, the same
 * way wherever they are offered: the primary navigation, the shelf header
 * and its "More" menu, and the command palette's "Go to" section.
 */
import { useCallback, useMemo, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import { useTranslation } from "../../../i18n";
import type { TopNav } from "../../../state/ui";
import {
  actionEnabled,
  actionVisible,
  contributionText,
  headerActionsAtom,
  renderPluginIcon,
  type RegisteredHeaderAction,
} from "../../plugins";
import { isPluginPage } from "../lib/menu-catalog";
import { coreDestination, type CoreDestinationMeta } from "../lib/menu-registry";
import { pluginMenuId } from "../state/menu-config";
import { useMenuCatalog } from "./useMenuLayouts";

export type Destination = {
  id: string;
  topNav: TopNav;
  label: string;
  icon: (size: number, active: boolean) => ReactNode;
  /** A built-in page: its registry entry (for copy keyed by page). */
  core?: CoreDestinationMeta;
  /** A plugin page: its contribution, which carries the plugin's state. */
  pluginAction?: RegisteredHeaderAction;
  /** False when the plugin currently disables its page. */
  enabled: boolean;
};

/** Describes a destination id — a built-in page or a plugin page. */
export function useDestination(): (id: string) => Destination | null {
  const { t } = useTranslation("nav");
  const headerActions = useAtomValue(headerActionsAtom);
  return useCallback(
    (id: string): Destination | null => {
      const core = coreDestination(id);
      if (core) {
        return {
          id,
          topNav: core.topNav,
          label: t(`header.${core.labelKey}`),
          icon: (size, active) => <core.Icon size={size} weight={active ? "fill" : "regular"} aria-hidden="true" />,
          core,
          enabled: true,
        };
      }
      const action = headerActions.find((entry) => isPluginPage(entry) && pluginMenuId(entry.key) === id);
      if (!action) return null;
      return {
        id,
        // pluginMenuId(key) and the plugin TopNav share the `plugin:<key>` shape.
        topNav: `plugin:${action.key}`,
        label: contributionText(action.title),
        icon: (size) => renderPluginIcon(action.icon, size),
        pluginAction: action,
        enabled: actionEnabled(action),
      };
    },
    [t, headerActions],
  );
}

/** Every destination that exists right now, in catalog order — built-ins
 *  first, then plugin pages — leaving out pages their plugin hides. */
export function useDestinations(): Destination[] {
  const catalog = useMenuCatalog();
  const describe = useDestination();
  return useMemo(
    () =>
      catalog.destinations
        .map(describe)
        .filter(
          (destination): destination is Destination =>
            destination !== null && (!destination.pluginAction || actionVisible(destination.pluginAction)),
        ),
    [catalog, describe],
  );
}
