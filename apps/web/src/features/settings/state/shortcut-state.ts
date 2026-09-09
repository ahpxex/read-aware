import { atom } from "jotai";
import { shortcutBindingsAtom } from "../../../state/ui";
import { contributionText } from "../../plugins/lib/plugin-i18n";
import { pluginCommandsAtom, selectionActionsAtom, textUnitReaderModeAtom } from "../../plugins/state/plugin-store";
import { shortcutRows, type ShortcutEnvironment } from "../lib/shortcut-catalog";

export const shortcutEnvironmentAtom = atom((get): ShortcutEnvironment => ({
  commands: get(pluginCommandsAtom).map(command => ({
    key: command.key, title: contributionText(command.title), defaultShortcut: command.defaultShortcut,
  })),
  modeAvailable: get(textUnitReaderModeAtom) !== null,
  lookupAvailable: get(selectionActionsAtom).some(action => action.role === "lookup"),
}));

/** UI, settings commands and key dispatch share provider availability. */
export const shortcutRowsAtom = atom(get =>
  shortcutRows(get(shortcutBindingsAtom), get(shortcutEnvironmentAtom)),
);
