/**
 * Sticky state for the host's generic text-unit reader-mode engine.
 *
 * Plugins define unit semantics and segmentation. The host persists only the
 * contribution identity, an opaque unit id, the current ordinal, interaction
 * preferences, and floating control positions. Existing
 * `read-aware-navigator-*` storage keys stay stable so the refactor does not
 * lose anyone's reading place.
 */

import { localKV } from "../../../platform/local-store";
import {
  readPluginSettingsValues,
  writePluginSettingsValues,
} from "../../plugins/lib/plugin-settings";

export type TextUnitResting = {
  sectionIndex: number;
  ordinal: number;
  cfiRange: string | null;
};

export type PersistedTextUnitModeState = {
  active: boolean;
  resting: TextUnitResting | null;
  /** Contribution key that produced the stored segmentation. Null is legacy. */
  modeKey: string | null;
  /** Unit id under which the ordinal was computed. */
  unitId: string | null;
};

const LEGACY_DEFAULT_UNIT_ID = "sentence";
const UNIT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MODE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}:[a-z0-9][a-z0-9-]{0,63}$/;

const INACTIVE_STATE: PersistedTextUnitModeState = {
  active: false,
  resting: null,
  modeKey: null,
  unitId: null,
};

const stateKey = (bookId: string) => `read-aware-navigator-state:${bookId}`;

function validUnitId(value: unknown): string | null {
  return typeof value === "string" && UNIT_ID_PATTERN.test(value) ? value : null;
}

function validModeKey(value: unknown): string | null {
  return typeof value === "string" && MODE_KEY_PATTERN.test(value) ? value : null;
}

/** Normalize current state and the two historical sentence-mode schemas. */
export function normalizeTextUnitModeState(value: unknown): PersistedTextUnitModeState {
  if (!value || typeof value !== "object") return INACTIVE_STATE;
  const parsed = value as {
    active?: unknown;
    resting?: unknown;
    modeKey?: unknown;
    unitId?: unknown;
    /** Pre-plugin field retained only as a read migration. */
    granularity?: unknown;
  };
  const resting = parsed.resting as Partial<TextUnitResting> | null | undefined;
  const unitId =
    validUnitId(parsed.unitId) ??
    validUnitId(parsed.granularity) ??
    // The oldest persisted states predate the unit field and were sentence-only.
    LEGACY_DEFAULT_UNIT_ID;
  return {
    active: parsed.active === true,
    resting:
      resting &&
      typeof resting.sectionIndex === "number" &&
      typeof resting.ordinal === "number"
        ? {
            sectionIndex: resting.sectionIndex,
            ordinal: resting.ordinal,
            cfiRange: typeof resting.cfiRange === "string" ? resting.cfiRange : null,
          }
        : null,
    modeKey: validModeKey(parsed.modeKey),
    unitId,
  };
}

export function readTextUnitModeState(bookId: string): PersistedTextUnitModeState {
  try {
    const raw = localKV.getItem(stateKey(bookId));
    return raw ? normalizeTextUnitModeState(JSON.parse(raw)) : INACTIVE_STATE;
  } catch {
    return INACTIVE_STATE;
  }
}

/** Legacy rows belong to the original built-in mode; current rows must match
 *  both the registering contribution and its opaque unit id. */
export function isTextUnitModeStateCompatible(
  state: PersistedTextUnitModeState,
  modeKey: string,
  unitId: string,
): boolean {
  return (state.modeKey === null || state.modeKey === modeKey) && state.unitId === unitId;
}

export function writeTextUnitModeState(
  bookId: string,
  state: PersistedTextUnitModeState,
): void {
  try {
    if (!state.active && !state.resting) {
      localKV.removeItem(stateKey(bookId));
      return;
    }
    localKV.setItem(stateKey(bookId), JSON.stringify(state));
  } catch {
    // Ignore persistence failures; in-session refs still carry the state.
  }
}

/**
 * Behavior settings for the text-unit mode. These live in the OWNING PLUGIN'S
 * declared-settings object (well-known field ids the plugin lists in its
 * manifest, e.g. sentence-reader), so the plugin's own settings page is the
 * single editing surface. The host reads them back here and supplies defaults
 * for anything the stored object misses.
 */
export type TextUnitModeSettings = {
  /** Null until the user (or the mode's default) picks a unit. */
  unitId: string | null;
  /** A quick tap on book content steps forward while the mode is on. */
  tapToAdvance: boolean;
  /** Swiping or scrolling steps once instead of continuously scrolling. */
  scrollToStep: boolean;
  /** The floating bar shows the position within the section (12 / 87). */
  showProgress: boolean;
  /** The floating bar counts time since mode entry — never persisted. */
  sessionTimer: boolean;
};

/** Must mirror the `value` defaults the plugin declares in its manifest. */
export const DEFAULT_TEXT_UNIT_MODE_SETTINGS: TextUnitModeSettings = {
  unitId: null,
  tapToAdvance: true,
  scrollToStep: false,
  showProgress: true,
  sessionTimer: true,
};

const LEGACY_BEHAVIOR_PREFS_KEY = "read-aware-navigator-prefs";

/** Contribution keys are `<pluginId>:<contributionId>`. */
function pluginIdOfModeKey(modeKey: string): string {
  return modeKey.slice(0, modeKey.indexOf(":"));
}

/**
 * One-time move of the retired app-owned prefs row into the mode plugin's
 * settings object. Stored plugin values win; the legacy row only fills gaps
 * (and its unit id only when it was written by this mode or predates keys).
 */
function migrateLegacyBehaviorPrefs(pluginId: string, modeKey: string): void {
  let raw: string | null = null;
  try {
    raw = localKV.getItem(LEGACY_BEHAVIOR_PREFS_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as {
      modeKey?: unknown;
      unitId?: unknown;
      granularity?: unknown;
      tapToAdvance?: unknown;
      scrollToStep?: unknown;
    };
    const merged = { ...readPluginSettingsValues(pluginId) };
    if (!("tapToAdvance" in merged)) merged.tapToAdvance = parsed.tapToAdvance !== false;
    if (!("scrollToStep" in merged)) merged.scrollToStep = parsed.scrollToStep === true;
    const legacyModeKey = validModeKey(parsed.modeKey);
    const legacyUnitId =
      validUnitId(parsed.unitId) ?? validUnitId(parsed.granularity) ?? LEGACY_DEFAULT_UNIT_ID;
    if (!("unitId" in merged) && (legacyModeKey === null || legacyModeKey === modeKey)) {
      merged.unitId = legacyUnitId;
    }
    writePluginSettingsValues(pluginId, merged);
  } catch {
    // An unreadable legacy row migrates nothing but is still consumed.
  }
  localKV.removeItem(LEGACY_BEHAVIOR_PREFS_KEY);
}

/** Read the mode's behavior settings from its plugin's settings object. */
export function readTextUnitModeSettings(modeKey: string | null): TextUnitModeSettings {
  if (!modeKey) return DEFAULT_TEXT_UNIT_MODE_SETTINGS;
  const pluginId = pluginIdOfModeKey(modeKey);
  migrateLegacyBehaviorPrefs(pluginId, modeKey);
  const stored = readPluginSettingsValues(pluginId);
  const defaults = DEFAULT_TEXT_UNIT_MODE_SETTINGS;
  return {
    unitId: validUnitId(stored.unitId),
    tapToAdvance:
      typeof stored.tapToAdvance === "boolean" ? stored.tapToAdvance : defaults.tapToAdvance,
    scrollToStep:
      typeof stored.scrollToStep === "boolean" ? stored.scrollToStep : defaults.scrollToStep,
    showProgress:
      typeof stored.showProgress === "boolean" ? stored.showProgress : defaults.showProgress,
    sessionTimer:
      typeof stored.sessionTimer === "boolean" ? stored.sessionTimer : defaults.sessionTimer,
  };
}

/** Merge a patch into the plugin's settings object (broadcasts the change). */
export function updateTextUnitModeSettings(
  modeKey: string,
  patch: Partial<TextUnitModeSettings>,
): void {
  const pluginId = pluginIdOfModeKey(modeKey);
  const merged = { ...readPluginSettingsValues(pluginId) };
  for (const [id, value] of Object.entries(patch)) {
    if (value === null) delete merged[id];
    else if (value !== undefined) merged[id] = value;
  }
  writePluginSettingsValues(pluginId, merged);
}

/** Center of a floating control, as fractions of the reader viewport (0..1). */
export type FloatPosition = { x: number; y: number };

const floatKey = (controlId: string) => `read-aware-reader-float:${controlId}`;

export function readFloatPosition(controlId: string): FloatPosition | null {
  try {
    const raw = localKV.getItem(floatKey(controlId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FloatPosition>;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return null;
    return {
      x: Math.min(1, Math.max(0, parsed.x)),
      y: Math.min(1, Math.max(0, parsed.y)),
    };
  } catch {
    return null;
  }
}

export function writeFloatPosition(controlId: string, position: FloatPosition): void {
  try {
    localKV.setItem(floatKey(controlId), JSON.stringify(position));
  } catch {
    // Ignore persistence failures; the in-session position still applies.
  }
}
