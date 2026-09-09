import type { SettingDescriptor } from "@read-aware/core";
import type { SettingDefinition, SettingsDraft } from "./catalog";
import { shortcutConflicts, shortcutFromTokens, shortcutRows, shortcutTokens } from "../../features/settings/lib/shortcut-catalog";

export function shortcutPreferenceDefinitions(draft: SettingsDraft): SettingDefinition[] {
  return shortcutRows(draft.shortcuts.bindings, draft.shortcuts).map(row => ({
    path: row.path, section: "shortcuts", label: row.label, kind: "key-chord", nullable: true, supportedTargets: ["global"],
    description: 'Device-local binding. Value is optional "mod", "alt", "shift" tokens followed by one KeyboardEvent.key (space is " "). Null removes the override and restores the registered default, not an unbind. Escape is reserved for overlays. Availability refers to registered providers, not current focus or command enablement. Unregistered plugin overrides remain readable/resettable; their default is unknown until registration and reported as null.',
    read: state => shortcutTokens(shortcutRows(state.shortcuts.bindings, state.shortcuts).find(entry => entry.id === row.id)?.binding),
    validate: value => shortcutTokens(shortcutFromTokens(value)),
    write: (state, value) => {
      if (value === null) delete state.shortcuts.bindings[row.id];
      else state.shortcuts.bindings[row.id] = shortcutFromTokens(value);
    },
  }));
}

export function shortcutMetadata(draft: SettingsDraft, path: string): SettingDescriptor["shortcut"] {
  const rows = shortcutRows(draft.shortcuts.bindings, draft.shortcuts);
  const row = rows.find(row => row.path === path);
  return row ? { defaultBinding: shortcutTokens(row.defaultBinding), overridden: row.overridden, available: row.available,
    conflicts: shortcutConflicts(row, rows).map(other => other.path) } : undefined;
}
