/**
 * Global key dispatch for plugin-command shortcuts (Settings → Shortcuts →
 * Plugins). A command fires anywhere in the app except while the user is
 * typing, and runs through the same result pipeline as the command palette,
 * so views open in the Dialog host and toasts attribute the plugin.
 */
import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { shortcutBindingsAtom } from "../../../state/ui";
import {
  isEditableKeyTarget,
  subscribeToAppKeyDown,
} from "../../../platform/app-keydown";
import {
  chordMatchesEvent,
  pluginShortcutId,
  resolvePluginBinding,
} from "../../settings/lib/shortcuts";
import { runPluginContribution } from "../lib/run-result";
import { pluginCommandsAtom } from "../state/plugin-store";

export function usePluginCommandShortcuts(): void {
  const bindings = useAtomValue(shortcutBindingsAtom);
  const commands = useAtomValue(pluginCommandsAtom);

  useEffect(() => {
    const bound = commands.flatMap((command) => {
      const chord = resolvePluginBinding(
        pluginShortcutId(command.key),
        bindings,
        command.defaultShortcut,
      );
      return chord ? [{ command, chord }] : [];
    });
    if (bound.length === 0) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isEditableKeyTarget(event.target)) return;
      for (const { command, chord } of bound) {
        if (chordMatchesEvent(chord, event)) {
          event.preventDefault();
          void runPluginContribution(command.pluginId, command.pluginName, command.run);
          return;
        }
      }
    }

    return subscribeToAppKeyDown(handleKeyDown);
  }, [bindings, commands]);
}
