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

export type ShortcutId =
  | "search"
  | "settings"
  | "next-page"
  | "prev-page"
  | "next-chapter"
  | "prev-chapter"
  | "toggle-controls"
  | "navigator-next-sentence"
  | "navigator-prev-sentence"
  | "selection-copy"
  | "selection-highlight"
  | "selection-underline"
  | "selection-add-note"
  | "selection-look-up"
  | "selection-ask-ai";

export type EditableShortcut = {
  id: ShortcutId;
  category: string;
  defaultBinding: KeyChord;
};

/** A reference-only row whose action isn't a rebindable key chord. Action labels
 *  live in the `settings` catalog under `shortcuts.actions.<id>`. */
export type InfoShortcut = {
  id: "close";
  category: string;
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
  { id: "search", category: "Global", defaultBinding: { mod: true, key: "k" } },
  { id: "settings", category: "Global", defaultBinding: { mod: true, key: "," } },
  { id: "next-page", category: "Reading", defaultBinding: { key: "ArrowRight" } },
  { id: "prev-page", category: "Reading", defaultBinding: { key: "ArrowLeft" } },
  { id: "next-chapter", category: "Reading", defaultBinding: { key: "]" } },
  { id: "prev-chapter", category: "Reading", defaultBinding: { key: "[" } },
  { id: "toggle-controls", category: "Reading", defaultBinding: { key: " " } },
  // Navigator steps fire only while the sentence navigator is on; they take
  // the arrow keys over the page-scroll fallback for the mode's duration.
  { id: "navigator-next-sentence", category: "Navigator", defaultBinding: { key: "ArrowDown" } },
  { id: "navigator-prev-sentence", category: "Navigator", defaultBinding: { key: "ArrowUp" } },
  // Selection actions fire only while text is selected in the reader (the
  // selection menu is up), so a bare letter is safe — it can't collide with
  // typing or with the reading shortcuts above.
  { id: "selection-copy", category: "Selection", defaultBinding: { key: "c" } },
  { id: "selection-highlight", category: "Selection", defaultBinding: { key: "h" } },
  { id: "selection-underline", category: "Selection", defaultBinding: { key: "u" } },
  { id: "selection-add-note", category: "Selection", defaultBinding: { key: "n" } },
  { id: "selection-look-up", category: "Selection", defaultBinding: { key: "l" } },
  { id: "selection-ask-ai", category: "Selection", defaultBinding: { key: "a" } },
];

/** Fixed, non-rebindable shortcuts shown for reference. */
export const INFO_SHORTCUTS: InfoShortcut[] = [
  { id: "close", category: "Overlays", keys: ["Esc"] },
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
