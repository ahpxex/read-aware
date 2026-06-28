import { isMacOS } from "../../../platform/environment";

/**
 * A normalized keyboard chord. `mod` abstracts the platform command key — ⌘ on
 * macOS, Ctrl elsewhere — so a binding stays correct across platforms. `key` is
 * a `KeyboardEvent.key`, single characters lowercased.
 */
export type KeyChord = {
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
  key: string;
};

export type ShortcutId = "search" | "settings" | "next-page" | "prev-page";

export type EditableShortcut = {
  id: ShortcutId;
  category: string;
  label: string;
  defaultBinding: KeyChord;
};

/** A reference-only row whose action isn't a rebindable key chord. */
export type InfoShortcut = {
  id: string;
  category: string;
  label: string;
  keys: string[];
};

/** Overrides keyed by shortcut id; a missing id falls back to its default. */
export type ShortcutBindings = Partial<Record<ShortcutId, KeyChord>>;

/**
 * The rebindable shortcuts. Defaults are the keys the app shipped with; the
 * real handlers (`useGlobalShortcuts`, the reader's key handler) resolve the
 * live binding through `resolveBinding`, so edits take effect immediately.
 */
export const EDITABLE_SHORTCUTS: EditableShortcut[] = [
  { id: "search", category: "Global", label: "Open search", defaultBinding: { mod: true, key: "k" } },
  { id: "settings", category: "Global", label: "Open settings", defaultBinding: { mod: true, key: "," } },
  { id: "next-page", category: "Reading", label: "Next page", defaultBinding: { key: "ArrowRight" } },
  { id: "prev-page", category: "Reading", label: "Previous page", defaultBinding: { key: "ArrowLeft" } },
];

/** Fixed, non-rebindable shortcuts shown for reference. */
export const INFO_SHORTCUTS: InfoShortcut[] = [
  { id: "toggle-controls", category: "Reading", label: "Toggle reader controls", keys: ["Click"] },
  { id: "close", category: "Overlays", label: "Close dialog or overlay", keys: ["Esc"] },
];

const DEFAULT_BINDINGS = new Map<ShortcutId, KeyChord>(
  EDITABLE_SHORTCUTS.map((shortcut) => [shortcut.id, shortcut.defaultBinding]),
);

export function defaultBinding(id: ShortcutId): KeyChord {
  return DEFAULT_BINDINGS.get(id)!;
}

/** The live binding for an action: the user's override, or the default. */
export function resolveBinding(id: ShortcutId, bindings: ShortcutBindings): KeyChord {
  return bindings[id] ?? defaultBinding(id);
}

const isSingleChar = (key: string) => key.length === 1;
const normalizeKey = (key: string) => (isSingleChar(key) ? key.toLowerCase() : key);

const MODIFIER_KEYS = new Set(["Control", "Meta", "Shift", "Alt", "AltGraph"]);

/** Build a chord from a keydown, or `null` while only modifiers are held. */
export function chordFromEvent(event: KeyboardEvent): KeyChord | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const chord: KeyChord = { key: normalizeKey(event.key) };
  if (event.metaKey || event.ctrlKey) chord.mod = true;
  if (event.altKey) chord.alt = true;
  if (event.shiftKey) chord.shift = true;
  return chord;
}

/** Whether a keydown matches a chord exactly — modifiers must match too. */
export function chordMatchesEvent(chord: KeyChord, event: KeyboardEvent): boolean {
  return (
    !!chord.mod === (event.metaKey || event.ctrlKey) &&
    !!chord.alt === event.altKey &&
    !!chord.shift === event.shiftKey &&
    chord.key.toLowerCase() === normalizeKey(event.key).toLowerCase()
  );
}

/** Canonical string for equality / conflict detection. */
export function chordSignature(chord: KeyChord): string {
  return [chord.mod && "mod", chord.alt && "alt", chord.shift && "shift", chord.key.toLowerCase()]
    .filter(Boolean)
    .join("+");
}

export function chordsEqual(a: KeyChord, b: KeyChord): boolean {
  return chordSignature(a) === chordSignature(b);
}

const KEY_LABELS: Record<string, string> = {
  ArrowRight: "→",
  ArrowLeft: "←",
  ArrowUp: "↑",
  ArrowDown: "↓",
  " ": "Space",
  Enter: "Enter",
  Escape: "Esc",
  Tab: "Tab",
  Backspace: "⌫",
  Delete: "Del",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Home: "Home",
  End: "End",
};

/** Render a chord to display tokens for `<Kbd>`, e.g. `["⌘", "K"]`. */
export function chordToTokens(chord: KeyChord): string[] {
  const mac = isMacOS();
  const tokens: string[] = [];
  if (chord.mod) tokens.push(mac ? "⌘" : "Ctrl");
  if (chord.alt) tokens.push(mac ? "⌥" : "Alt");
  if (chord.shift) tokens.push(mac ? "⇧" : "Shift");
  tokens.push(KEY_LABELS[chord.key] ?? (isSingleChar(chord.key) ? chord.key.toUpperCase() : chord.key));
  return tokens;
}
