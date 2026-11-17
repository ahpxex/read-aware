import type { ReactNode } from "react";
import { useAtomValue } from "jotai";
import { useTranslation } from "../../../i18n";
import type { TopNav } from "../../../state/ui";
import { coreDestination, isPluginPage, pluginMenuId } from "../../menus";
import { contributionText, headerActionsAtom, renderPluginIcon, type RegisteredHeaderAction } from "../../plugins";

export type Destination = {
  id: string;
  topNav: TopNav;
  label: string;
  /** Icon for the shelf header and its "More" menu. */
  icon: (size: number, active: boolean) => ReactNode;
  /** Set for a plugin page: its own button carries the plugin's state. */
  pluginAction?: RegisteredHeaderAction;
};

/**
 * Describes a destination id — a built-in page or a plugin page — the same
 * way wherever it is placed: the primary navigation or the shelf header.
 */
export function useDestination(): (id: string) => Destination | null {
  const { t } = useTranslation("nav");
  const pages = useAtomValue(headerActionsAtom).filter(isPluginPage);
  return (id) => {
    const core = coreDestination(id);
    if (core) {
      return {
        id,
        topNav: core.topNav,
        label: t(`header.${core.labelKey}`),
        icon: (size, active) => <core.Icon size={size} weight={active ? "fill" : "regular"} aria-hidden="true" />,
      };
    }
    const action = pages.find((page) => pluginMenuId(page.key) === id);
    if (!action) return null;
    return {
      id,
      // pluginMenuId(key) and the plugin TopNav share the `plugin:<key>` shape.
      topNav: `plugin:${action.key}`,
      label: contributionText(action.title),
      icon: (size) => renderPluginIcon(action.icon, size),
      pluginAction: action,
    };
  };
}
