import type { KeyChord, ShortcutBindings, ShortcutId } from "./shortcuts";

import { localKV } from "../../../platform/local-store";

const STORAGE_KEY = "read-aware-shortcuts";

function isChord(value: unknown): value is KeyChord {
  return !!value && typeof value === "object" && typeof (value as KeyChord).key === "string";
}

/** Read the user's shortcut overrides (only the rebound ones are stored). */
export function getShortcutBindings(): ShortcutBindings {
  try {
    const raw = localKV.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const result: ShortcutBindings = {};
    for (const [id, chord] of Object.entries(parsed)) {
      if (isChord(chord)) result[id as ShortcutId] = chord;
    }
    return result;
  } catch {
    return {};
  }
}

export function saveShortcutBindings(bindings: ShortcutBindings): void {
  localKV.setItem(STORAGE_KEY, JSON.stringify(bindings));
}
