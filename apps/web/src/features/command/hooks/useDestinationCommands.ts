import { useMemo } from "react";
import { useTranslation } from "../../../i18n";
import { hostCommandForPage } from "../../../services/host-commands";
import type { TopNav } from "../../../state/ui";
import { useDestinations } from "../../menus";
import type { CommandDestination } from "../lib/build-commands";

/**
 * The palette's "Go to" pages: every destination the app has — the same list
 * the navigation and shelf header arrange — so a new page (built-in or
 * plugin) is offered without a palette entry of its own. A page the host
 * command catalog covers runs that command, sharing the Agent's semantics
 * (Library opens the shelf's root); any other page opens like a header click.
 */
export function useDestinationCommands(openPage: (topNav: TopNav) => void): CommandDestination[] {
  const { t } = useTranslation("command");
  const destinations = useDestinations();
  return useMemo(
    () =>
      destinations.map((destination): CommandDestination => {
        const common = {
          id: destination.id,
          topNav: destination.topNav,
          title: destination.label,
          subtitle: destination.pluginAction?.pluginName,
          keywords: destination.core ? t(`destinations.${destination.core.labelKey}.keywords`) : undefined,
          icon: destination.icon(16, false),
          disabled: !destination.enabled,
        };
        const hostCommand = hostCommandForPage(destination.topNav);
        return hostCommand
          ? { ...common, hostCommand: { id: hostCommand } }
          : { ...common, open: () => openPage(destination.topNav) };
      }),
    [destinations, openPage, t],
  );
}
