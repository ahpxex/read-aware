/**
 * Resolves the user-arranged `primaryNav` layout into renderable destinations:
 * built-in surfaces (Library, Agent, Reading stats) plus shelf plugin page
 * contributions. The centered switcher renders exactly this list, and the
 * header's back-button reachability guard keys off it.
 */
import { useAtomValue } from "jotai";
import { useTranslation } from "../../../i18n";
import type { TopNav } from "../../../state/ui";
import { CORE_MENU_ITEMS } from "../../menus/lib/menu-registry";
import {
  clampPrimaryNavVisible,
  menuConfigAtom,
  pluginMenuId,
  resolveSurfaceLayout,
} from "../../menus/state/menu-config";
import { contributionText } from "../../plugins/lib/plugin-i18n";
import { headerActionsAtom } from "../../plugins/state/plugin-store";

export type PrimaryDestination = {
  id: string;
  topNav: TopNav;
  label: string;
};

const CORE_TOP_NAV: Record<string, TopNav> = {
  "core:library": "shelf",
  "core:agent": "context",
  "core:stats": "stats",
};

export function usePrimaryDestinations(): PrimaryDestination[] {
  const { t } = useTranslation("nav");
  const menuConfig = useAtomValue(menuConfigAtom);
  const pageActions = useAtomValue(headerActionsAtom).filter(
    (action) => action.surface === "shelf" && action.presentation === "page",
  );

  const layout = resolveSurfaceLayout(menuConfig.primaryNav, [
    ...CORE_MENU_ITEMS.primaryNav.map((item) => item.id),
    ...pageActions.map((action) => pluginMenuId(action.key)),
  ]);
  const coreLabels: Record<string, string> = {
    "core:library": t("header.library"),
    "core:agent": t("header.agent"),
    "core:stats": t("header.stats"),
  };

  return clampPrimaryNavVisible(layout.visible)
    .map((id): PrimaryDestination | null => {
      if (id.startsWith("plugin:")) {
        const action = pageActions.find(
          (entry) => pluginMenuId(entry.key) === id,
        );
        // pluginMenuId(key) and the plugin TopNav share the `plugin:<key>` shape.
        if (!action) return null;
        return { id, topNav: id as TopNav, label: contributionText(action.title) };
      }
      const topNav = CORE_TOP_NAV[id];
      return topNav ? { id, topNav, label: coreLabels[id] } : null;
    })
    .filter((destination): destination is PrimaryDestination =>
      destination !== null,
    );
}
