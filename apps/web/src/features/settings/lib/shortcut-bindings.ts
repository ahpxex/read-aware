import type { KeyChord, ShortcutBindings, ShortcutId } from "./shortcuts";

import { localKV } from "../../../platform/local-store";

const STORAGE_KEY = "read-aware-shortcuts";

const LEGACY_IDS: Record<string, ShortcutId> = {
  "navigator-next-sentence": "reader-mode-next-unit",
  "navigator-prev-sentence": "reader-mode-prev-unit",
};

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
    return normalizeShortcutBindings(parsed);
  } catch {
    return {};
  }
}

/** Normalize persisted overrides and migrate the pre-plugin action ids. */
export function normalizeShortcutBindings(parsed: unknown): ShortcutBindings {
  if (!parsed || typeof parsed !== "object") return {};
  const result: ShortcutBindings = {};
  for (const [storedId, chord] of Object.entries(parsed)) {
    const id = LEGACY_IDS[storedId] ?? (storedId as ShortcutId);
    if (!isChord(chord)) continue;
    if (LEGACY_IDS[storedId]) {
      if (result[id] === undefined) result[id] = chord;
    } else {
      result[id] = chord;
    }
  }
  return result;
}

export function saveShortcutBindings(bindings: ShortcutBindings): void {
  localKV.setItem(STORAGE_KEY, JSON.stringify(bindings));
}
