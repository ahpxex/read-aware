/**
 * Sticky state for the host's generic text-unit reader-mode engine.
 *
 * Plugins define unit semantics and segmentation. The host persists only the
 * contribution identity, an opaque unit id, the current ordinal, interaction
 * preferences, and floating control positions. Existing
 * `read-aware-navigator-*` storage keys stay stable so the refactor does not
 * lose anyone's reading place.
 */

import { afterLocalKVWrites, localKV, setLocalKVBatch } from "../../../platform/local-store";
import { createLogger } from "../../../platform/logger";
import {
  readPluginSettingsValues,
  pluginSettingsKey,
} from "../../plugins/lib/plugin-settings";
import type { PluginFormValues } from "@read-aware/plugin-types";

const log = createLogger("reading-mode-state");
function observedWrite(write: Promise<void>): Promise<void> {
  // Native UI/background callers can ignore the receipt; actor commands retain it.
  void write.catch(error => log.warn("Reading mode state was not saved", error));
  return write;
}

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
  /** Unversioned legacy positions must not be reused against current content. */
  contentVersion: string | null;
};

const LEGACY_DEFAULT_UNIT_ID = "sentence";
const UNIT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MODE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}:[a-z0-9][a-z0-9-]{0,63}$/;

const INACTIVE_STATE: PersistedTextUnitModeState = {
  active: false,
  resting: null,
  modeKey: null,
  unitId: null,
  contentVersion: null,
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
    contentVersion?: unknown;
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
        Number.isSafeInteger(resting.sectionIndex) && resting.sectionIndex! >= 0 &&
        Number.isSafeInteger(resting.ordinal) && resting.ordinal! >= 0
        ? {
            sectionIndex: resting.sectionIndex!,
            ordinal: resting.ordinal!,
            cfiRange: typeof resting.cfiRange === "string" ? resting.cfiRange : null,
          }
        : null,
    modeKey: validModeKey(parsed.modeKey),
    unitId,
    contentVersion: typeof parsed.contentVersion === "string" && parsed.contentVersion.length > 0 ? parsed.contentVersion : null,
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

/** Restoring an address requires the exact content, contribution and unit.
 *  Legacy preferences survive, but unversioned positions are not reusable. */
export function isTextUnitModeStateCompatible(
  state: PersistedTextUnitModeState,
  modeKey: string,
  unitId: string,
  contentVersion: string | null,
): boolean {
  return Boolean(contentVersion && state.contentVersion === contentVersion && state.modeKey === modeKey && state.unitId === unitId);
}

export function writeTextUnitModeState(
  bookId: string,
  state: PersistedTextUnitModeState,
): Promise<void> {
  try {
    if (!state.active && !state.resting && !state.modeKey) {
      return observedWrite(localKV.removeItemAsync(stateKey(bookId)));
    }
    return observedWrite(localKV.setItemAsync(stateKey(bookId), JSON.stringify(state)));
  } catch (error) {
    return observedWrite(Promise.reject(error));
  }
}

/** One configuration intent cannot leave the book and provider preference disagreeing. */
export function writeTextUnitModeConfiguration(bookId: string, state: PersistedTextUnitModeState, persistUnit: boolean): Promise<void> {
  const entries = new Map<string, string | null>([[stateKey(bookId), JSON.stringify(state)]]);
  if (persistUnit && state.modeKey && state.unitId) {
    const pluginId = pluginIdOfModeKey(state.modeKey);
    const { values, consumeLegacy } = modeSettingsWithLegacy(state.modeKey);
    if (consumeLegacy || values.unitId !== state.unitId) {
      entries.set(pluginSettingsKey(pluginId), JSON.stringify({ ...values, unitId: state.unitId }));
    }
    if (consumeLegacy) entries.set(LEGACY_BEHAVIOR_PREFS_KEY, null);
  }
  return observedWrite(setLocalKVBatch(entries));
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
 * Reading is side-effect free. Only an explicit settings/configuration commit
 * consumes the legacy row, in the same transaction as its destination.
 */
function modeSettingsWithLegacy(modeKey: string): { values: PluginFormValues; consumeLegacy: boolean } {
  const values = readPluginSettingsValues(pluginIdOfModeKey(modeKey));
  const raw = localKV.getItem(LEGACY_BEHAVIOR_PREFS_KEY);
  if (!raw) return { values, consumeLegacy: false };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { values, consumeLegacy: true };
    const legacy = parsed as Record<string, unknown>;
    const legacyModeKey = validModeKey(legacy.modeKey);
    // Discovery/selection of another provider must not steal the saved owner.
    if (legacyModeKey && legacyModeKey !== modeKey) return { values, consumeLegacy: false };
    const merged = { ...values };
    if (!("tapToAdvance" in merged)) merged.tapToAdvance = legacy.tapToAdvance !== false;
    if (!("scrollToStep" in merged)) merged.scrollToStep = legacy.scrollToStep === true;
    const legacyUnitId =
      validUnitId(legacy.unitId) ?? validUnitId(legacy.granularity) ?? LEGACY_DEFAULT_UNIT_ID;
    if (!("unitId" in merged)) {
      merged.unitId = legacyUnitId;
    }
    return { values: merged, consumeLegacy: true };
  } catch {
    // Malformed legacy JSON supplies no preferences; only a successful commit discards it.
    return { values, consumeLegacy: true };
  }
}

/** Read the mode's behavior settings from its plugin's settings object. */
export function readTextUnitModeSettings(modeKey: string | null): TextUnitModeSettings {
  if (!modeKey) return DEFAULT_TEXT_UNIT_MODE_SETTINGS;
  const { values: stored } = modeSettingsWithLegacy(modeKey);
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
): Promise<void> {
  return observedWrite(afterLocalKVWrites(() => {
    const { values: merged, consumeLegacy } = modeSettingsWithLegacy(modeKey);
    for (const [id, value] of Object.entries(patch)) {
      if (value === null) delete merged[id];
      else if (value !== undefined) merged[id] = value;
    }
    const entries = new Map<string, string | null>([[pluginSettingsKey(pluginIdOfModeKey(modeKey)), JSON.stringify(merged)]]);
    if (consumeLegacy) entries.set(LEGACY_BEHAVIOR_PREFS_KEY, null);
    return setLocalKVBatch(entries);
  }));
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
