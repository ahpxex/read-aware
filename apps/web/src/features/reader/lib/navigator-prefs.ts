/**
 * Sticky sentence-navigator state (interim localStorage/KV). Two concerns:
 *
 * - Per-book navigator state: whether the mode is on and which sentence the
 *   wash rests on, so closing a book (or the app) and reopening it resumes
 *   sentence-by-sentence reading exactly where it stopped. Exiting the mode
 *   explicitly forgets the position — re-entering starts at the visible text.
 * - Floating-control positions: where the user dragged the navigator's
 *   floating step buttons / action bar, stored per control as fractions of the
 *   reader viewport so they survive resizes and device rotation.
 */

import { localKV } from "../../../platform/local-store";

export type NavigatorResting = {
  sectionIndex: number;
  ordinal: number;
  cfiRange: string | null;
};

export type PersistedNavigatorState = {
  active: boolean;
  resting: NavigatorResting | null;
};

const INACTIVE_STATE: PersistedNavigatorState = { active: false, resting: null };

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
