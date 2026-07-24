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

/** App-level stepping behavior, shared across books and compatible modes. */
export type TextUnitModeBehaviorPrefs = {
  /** Contribution whose unit id is stored below. Null is the legacy schema. */
  modeKey: string | null;
  /** Null until an installed mode supplies its default unit. */
  unitId: string | null;
  /** A quick tap on book content steps forward while the mode is on. */
  tapToAdvance: boolean;
  /** Swiping or scrolling steps once instead of continuously scrolling. */
  scrollToStep: boolean;
};

export const DEFAULT_TEXT_UNIT_MODE_BEHAVIOR_PREFS: TextUnitModeBehaviorPrefs = {
  modeKey: null,
  unitId: null,
  tapToAdvance: true,
  scrollToStep: false,
};

const BEHAVIOR_PREFS_KEY = "read-aware-navigator-prefs";

/** Normalize current preferences and the historical `granularity` field. */
export function normalizeTextUnitModeBehaviorPrefs(
  value: unknown,
): TextUnitModeBehaviorPrefs {
  if (!value || typeof value !== "object") return DEFAULT_TEXT_UNIT_MODE_BEHAVIOR_PREFS;
  const parsed = value as {
    modeKey?: unknown;
    unitId?: unknown;
    granularity?: unknown;
    tapToAdvance?: unknown;
    scrollToStep?: unknown;
  };
  return {
    modeKey: validModeKey(parsed.modeKey),
    unitId:
      validUnitId(parsed.unitId) ??
      validUnitId(parsed.granularity) ??
      LEGACY_DEFAULT_UNIT_ID,
    tapToAdvance: parsed.tapToAdvance !== false,
    scrollToStep: parsed.scrollToStep === true,
  };
}

export function readTextUnitModeBehaviorPrefs(): TextUnitModeBehaviorPrefs {
  try {
    const raw = localKV.getItem(BEHAVIOR_PREFS_KEY);
    return raw
      ? normalizeTextUnitModeBehaviorPrefs(JSON.parse(raw))
      : DEFAULT_TEXT_UNIT_MODE_BEHAVIOR_PREFS;
  } catch {
    return DEFAULT_TEXT_UNIT_MODE_BEHAVIOR_PREFS;
  }
}

/** Do not leak a unit choice between two reader-mode contributions that happen
 *  to reuse the same unit id. Null mode keys are the pre-plugin schema. */
export function preferredTextUnitModeUnitId(
  prefs: TextUnitModeBehaviorPrefs,
  modeKey: string,
): string | null {
  return prefs.modeKey === null || prefs.modeKey === modeKey ? prefs.unitId : null;
}

export function writeTextUnitModeBehaviorPrefs(prefs: TextUnitModeBehaviorPrefs): void {
  try {
    localKV.setItem(BEHAVIOR_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore persistence failures; the atom still carries the value in session.
  }
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
