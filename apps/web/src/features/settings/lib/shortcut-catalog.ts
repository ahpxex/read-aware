import { AppError } from "@read-aware/core";
import { EDITABLE_SHORTCUTS, chordSignature, pluginShortcutId, resolveBinding, resolvePluginBinding, type KeyChord, type ShortcutBindings, type ShortcutId } from "./shortcuts";

export type ShortcutEnvironment = {
  commands: readonly { key: string; title: string; defaultShortcut?: KeyChord }[];
  modeAvailable: boolean;
  lookupAvailable: boolean;
};
export type ShortcutRow = { id: ShortcutId; path: string; label: string; defaultBinding?: KeyChord; binding?: KeyChord; available: boolean; overridden: boolean };

/** Encode the opaque contribution key as one path segment, never a wildcard. */
export function shortcutSettingPath(id: ShortcutId): string {
  if (!id.startsWith("plugin:")) return `shortcuts.${id}`;
  const key = encodeURIComponent(id.slice(7)).replace(/[.!~*'()]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `shortcuts.plugin.${key}`;
}

export function shortcutRows(bindings: ShortcutBindings, env: ShortcutEnvironment): ShortcutRow[] {
  return [
    ...EDITABLE_SHORTCUTS.map(shortcut => ({ id: shortcut.id, path: shortcutSettingPath(shortcut.id), label: shortcut.id,
      defaultBinding: shortcut.defaultBinding, binding: resolveBinding(shortcut.id, bindings), overridden: bindings[shortcut.id] !== undefined,
      available: (shortcut.category !== "TextUnitMode" || env.modeAvailable) && (shortcut.id !== "selection-look-up" || env.lookupAvailable) })),
    ...env.commands.map(command => { const id = pluginShortcutId(command.key); return { id, path: shortcutSettingPath(id), label: command.title,
      defaultBinding: command.defaultShortcut, binding: resolvePluginBinding(id, bindings, command.defaultShortcut), overridden: bindings[id] !== undefined, available: true }; }),
  ];
}

export function shortcutConflicts(row: ShortcutRow, rows: ShortcutRow[]): ShortcutRow[] {
  if (!row.available || !row.binding) return [];
  const signature = chordSignature(row.binding);
  return rows.filter(other => other.id !== row.id && other.available && other.binding && chordSignature(other.binding) === signature);
}

/** Tokens are modifiers followed by one KeyboardEvent.key, not display glyphs. */
export function shortcutTokens(chord: KeyChord | undefined): string[] | null {
  return chord ? [...(chord.mod ? ["mod"] : []), ...(chord.alt ? ["alt"] : []), ...(chord.shift ? ["shift"] : []), chord.key] : null;
}

const MODIFIERS = new Set(["mod", "alt", "shift"]);
const NAMED_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "Tab", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown", ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`)]);
export function shortcutFromTokens(value: unknown): KeyChord {
  const invalid = () => new AppError("settings/invalid-shortcut", "Expected modifier tokens followed by one supported key");
  if (!Array.isArray(value) || value.length < 1 || value.length > 4 || value.some(token => typeof token !== "string")) throw invalid();
  const modifiers = value.slice(0, -1) as string[];
  const key = value.at(-1) as string;
  if (new Set(modifiers).size !== modifiers.length || modifiers.some(token => !MODIFIERS.has(token))) throw invalid();
  if (!NAMED_KEYS.has(key) && !(Array.from(key).length === 1 && !/[\p{C}]/u.test(key))) throw invalid();
  return { key: Array.from(key).length === 1 ? key.toLowerCase() : key,
    ...(modifiers.includes("mod") ? { mod: true } : {}), ...(modifiers.includes("alt") ? { alt: true } : {}), ...(modifiers.includes("shift") ? { shift: true } : {}) };
}

/** Validate the final batch, allowing swaps and leaving unrelated legacy conflicts alone. */
export function assertShortcutChanges(before: ShortcutBindings, after: ShortcutBindings, env: ShortcutEnvironment) {
  const rows = shortcutRows(after, env);
  for (const row of rows) {
    if (JSON.stringify(before[row.id]) === JSON.stringify(after[row.id])) continue;
    if (shortcutConflicts(row, rows).length) throw new AppError("settings/shortcut-conflict", `Shortcut conflict for ${row.id}`);
  }
}
