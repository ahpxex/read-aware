import { getDefaultStore } from "jotai";
import { isEditableKeyTarget } from "../../../platform/app-keydown";
import { shortcutRowsAtom } from "../state/shortcut-state";
import type { ShortcutRow } from "./shortcut-catalog";
import { chordMatchesEvent, type ShortcutId } from "./shortcuts";

export type ShortcutDispatch =
  | { kind: "none" }
  | { kind: "command"; id: ShortcutId }
  | { kind: "conflict"; ids: ShortcutId[] };

const GLOBAL_IDS = new Set<ShortcutId>(["search", "settings", "new-conversation"]);

export function isAppSurfaceShortcut(id: ShortcutId | undefined): boolean {
  return id !== undefined && (GLOBAL_IDS.has(id) || id.startsWith("plugin:"));
}

/** Same conservative conflict space as settings: no registration-order winner. */
export function resolveShortcutDispatch(rows: readonly ShortcutRow[], event: KeyboardEvent): ShortcutDispatch {
  if (event.defaultPrevented || event.isComposing || event.key === "Escape") return { kind: "none" };
  const matches = rows.filter(row => row.available && row.binding && chordMatchesEvent(row.binding, event));
  // Typing must remain possible even when bare-letter bindings conflict. Global
  // shortcuts remain global, but never acquire priority over a conflicting row.
  if (isEditableKeyTarget(event.target) && !matches.some(row => GLOBAL_IDS.has(row.id))) return { kind: "none" };
  if (matches.length > 1) return { kind: "conflict", ids: matches.map(row => row.id) };
  return matches.length ? { kind: "command", id: matches[0]!.id } : { kind: "none" };
}

/** Read synchronously, including registrations that React has not rendered yet. */
export function appShortcutForEvent(event: KeyboardEvent): ShortcutId | undefined {
  const decision = resolveShortcutDispatch(getDefaultStore().get(shortcutRowsAtom), event);
  if (decision.kind === "conflict") event.preventDefault();
  return decision.kind === "command" ? decision.id : undefined;
}
