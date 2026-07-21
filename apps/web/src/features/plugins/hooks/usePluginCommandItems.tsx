/**
 * Plugin contributions as command-palette items — the unconditional fallback
 * entry point for every installed action (docs/plugin-system.md §7): explicit
 * plugin commands plus shelf header actions (pages navigate, popups open in
 * the Dialog host). Reader-surface actions stay out — they need an open book.
 */
import { useMemo } from "react";
import { useAtomValue } from "jotai";
import type { CommandItem } from "../../command/lib/build-commands";
import { openHeaderActionDialog } from "../lib/open-header-action";
import { renderPluginIcon } from "../lib/plugin-icons";
import { runPluginContribution } from "../lib/run-result";
import { headerActionsAtom, pluginCommandsAtom } from "../state/plugin-store";

export function usePluginCommandItems(openPluginPage: (key: string) => void): CommandItem[] {
  const commands = useAtomValue(pluginCommandsAtom);
  const headerActions = useAtomValue(headerActionsAtom);

  return useMemo(() => {
    const items: CommandItem[] = [];
    for (const command of commands) {
      items.push({
        id: `plugin-command-${command.key}`,
        kind: "action",
        group: "plugins",
        title: command.title,
        subtitle: command.pluginName,
        keywords: command.keywords,
        icon: renderPluginIcon(command.icon, 16),
        perform: () => {
          void runPluginContribution(command.pluginId, command.pluginName, command.run);
        },
      });
    }
    for (const action of headerActions) {
      if (action.surface !== "shelf") continue;
      items.push({
        id: `plugin-action-${action.key}`,
        kind: "action",
        group: "plugins",
        title: action.title,
        subtitle: action.pluginName,
        icon: renderPluginIcon(action.icon, 16),
        perform: () => {
          if (action.presentation === "page") openPluginPage(action.key);
          else void openHeaderActionDialog(action, {});
        },
      });
    }
    return items;
  }, [commands, headerActions, openPluginPage]);
}
