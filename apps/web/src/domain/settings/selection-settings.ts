import { localKV } from "../../platform/local-store";

export const SELECTION_SETTINGS_KEY = "read-aware-selection";

/** How a hand-made text selection in the reader is treated. Persisted, device-local. */
export type SelectionSettings = {
  /**
   * Move the edges of a selection onto the sentence, clause and word
   * boundaries it nearly reaches, and continue a selection that runs off the
   * page to the end of its sentence. Adjusting a snapped selection's handles
   * again keeps the reader's adjustment.
   */
  snapToText: boolean;
};

export const DEFAULT_SELECTION_SETTINGS: SelectionSettings = { snapToText: true };

export function normalizeSelectionSettings(raw: unknown): SelectionSettings {
  const stored = raw && typeof raw === "object" ? (raw as Partial<Record<keyof SelectionSettings, unknown>>) : {};
  return {
    snapToText: typeof stored.snapToText === "boolean" ? stored.snapToText : DEFAULT_SELECTION_SETTINGS.snapToText,
  };
}

export function getSelectionSettings(): SelectionSettings {
  try {
    const raw = localKV.getItem(SELECTION_SETTINGS_KEY);
    return raw ? normalizeSelectionSettings(JSON.parse(raw)) : DEFAULT_SELECTION_SETTINGS;
  } catch {
    // A corrupt record reads as the defaults; the next save replaces it.
    return DEFAULT_SELECTION_SETTINGS;
  }
}

export function saveSelectionSettings(settings: SelectionSettings): void {
  localKV.setItem(SELECTION_SETTINGS_KEY, JSON.stringify(settings));
}
