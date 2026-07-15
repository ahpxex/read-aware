/**
 * Sticky sentence-navigator state (interim localStorage/KV). Three concerns:
 *
 * - Per-book navigator state: whether the mode is on and which sentence the
 *   wash rests on, so closing a book (or the app) and reopening it resumes
 *   sentence-by-sentence reading exactly where it stopped. Exiting the mode
 *   explicitly forgets the position — re-entering starts at the visible text.
 * - Navigator behavior preferences (app-level, not per book): the step
 *   granularity and whether a tap on book content steps forward.
 * - Floating-control positions: where the user dragged the navigator's
 *   floating step buttons / action bar, stored per control as fractions of the
 *   reader viewport so they survive resizes and device rotation.
 */

import { localKV } from "../../../platform/local-store";
import type { NavigatorGranularity } from "./sentence-index";

export type NavigatorResting = {
  sectionIndex: number;
  ordinal: number;
  cfiRange: string | null;
};

export type PersistedNavigatorState = {
  active: boolean;
  resting: NavigatorResting | null;
  /** Granularity the resting ordinal was computed under. An ordinal only
   *  addresses a unit within one segmentation — restored under another
   *  granularity it would land on an unrelated spot. */
  granularity: NavigatorGranularity;
};

const INACTIVE_STATE: PersistedNavigatorState = {
  active: false,
  resting: null,
  granularity: "sentence",
};

const stateKey = (bookId: string) => `read-aware-navigator-state:${bookId}`;

export function readNavigatorState(bookId: string): PersistedNavigatorState {
  try {
    const raw = localKV.getItem(stateKey(bookId));
    if (!raw) return INACTIVE_STATE;
    const parsed = JSON.parse(raw) as Partial<PersistedNavigatorState>;
    const resting = parsed.resting;
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
      // States written before granularity existed were all sentence-based.
      granularity: parsed.granularity === "paragraph" ? "paragraph" : "sentence",
    };
  } catch {
    return INACTIVE_STATE;
  }
}

export function writeNavigatorState(bookId: string, state: PersistedNavigatorState): void {
  try {
    if (!state.active && !state.resting) {
      localKV.removeItem(stateKey(bookId));
      return;
    }
    localKV.setItem(stateKey(bookId), JSON.stringify(state));
  } catch {
    // Ignore persistence failures — the in-session refs still carry the state.
  }
}

/** App-level navigator behavior — how stepping works, across all books. */
export type NavigatorBehaviorPrefs = {
  granularity: NavigatorGranularity;
  /** A quick tap on book content steps forward while the mode is on (the
   *  shell toggle moves to the floating bar's toolbars button meanwhile). */
  tapToAdvance: boolean;
};

export const DEFAULT_NAVIGATOR_BEHAVIOR_PREFS: NavigatorBehaviorPrefs = {
  granularity: "sentence",
  tapToAdvance: true,
};

const BEHAVIOR_PREFS_KEY = "read-aware-navigator-prefs";

export function readNavigatorBehaviorPrefs(): NavigatorBehaviorPrefs {
  try {
    const raw = localKV.getItem(BEHAVIOR_PREFS_KEY);
    if (!raw) return DEFAULT_NAVIGATOR_BEHAVIOR_PREFS;
    const parsed = JSON.parse(raw) as Partial<NavigatorBehaviorPrefs>;
    return {
      granularity: parsed.granularity === "paragraph" ? "paragraph" : "sentence",
      tapToAdvance: parsed.tapToAdvance !== false,
    };
  } catch {
    return DEFAULT_NAVIGATOR_BEHAVIOR_PREFS;
  }
}

export function writeNavigatorBehaviorPrefs(prefs: NavigatorBehaviorPrefs): void {
  try {
    localKV.setItem(BEHAVIOR_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore persistence failures — the atom still carries the value in session.
  }
}

// Whether the floating bar shows its full action set or just the navigation
// essentials. Per device, like the float positions — how much bar fits
// comfortably is a screen trait, not user data worth syncing.
const BAR_EXPANDED_KEY = "read-aware-navigator-bar-expanded";

export function readNavigatorBarExpanded(defaultValue: boolean): boolean {
  try {
    const raw = localKV.getItem(BAR_EXPANDED_KEY);
    if (raw == null) return defaultValue;
    return raw === "true";
  } catch {
    return defaultValue;
  }
}

export function writeNavigatorBarExpanded(expanded: boolean): void {
  try {
    localKV.setItem(BAR_EXPANDED_KEY, String(expanded));
  } catch {
    // Ignore persistence failures — the in-session state still applies.
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
    // Ignore persistence failures — the in-session position still applies.
  }
}
