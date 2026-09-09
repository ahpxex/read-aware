/**
 * Global key dispatch for plugin-command shortcuts (Settings → Shortcuts →
 * Plugins). A command fires anywhere in the app except while the user is
 * typing, and runs through the same result pipeline as the command palette,
 * so views open in the Dialog host and toasts attribute the plugin.
 */
import { useEffect } from "react";
import { getDefaultStore } from "jotai";
import {
  isEditableKeyTarget,
  subscribeToAppKeyDown,
} from "../../../platform/app-keydown";
import { pluginShortcutId } from "../../settings/lib/shortcuts";
import { appShortcutForEvent } from "../../settings/lib/shortcut-dispatch";
import { runPluginContribution } from "../lib/run-result";
import { pluginCommandsAtom } from "../state/plugin-store";
import { actionEnabled } from "../lib/plugin-action-state";

export function usePluginCommandShortcuts(): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || isEditableKeyTarget(event.target)) return;
      const shortcut = appShortcutForEvent(event);
      const command = getDefaultStore().get(pluginCommandsAtom).find(command => pluginShortcutId(command.key) === shortcut);
      if (command) {
        event.preventDefault();
        if (!actionEnabled(command)) return;
        void runPluginContribution(command.pluginId, command.pluginName, command.run);
      }
    }

    return subscribeToAppKeyDown(handleKeyDown);
  }, []);
}
