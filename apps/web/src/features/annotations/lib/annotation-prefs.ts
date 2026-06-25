import type { Highlight } from "./annotation-types";

/**
 * Sticky annotation preferences (interim localStorage). The default mark colour
 * is the colour new one-click highlights/underlines use; it follows the last
 * colour the reader applied via the recolor menu.
 */

const DEFAULT_COLOR_KEY = "read-aware-default-mark-color";
const COLORS: Highlight["color"][] = ["yellow", "green", "blue", "pink"];
const FALLBACK_COLOR: Highlight["color"] = "yellow";

export function getDefaultMarkColor(): Highlight["color"] {
  try {
    const raw = localStorage.getItem(DEFAULT_COLOR_KEY);
    return COLORS.includes(raw as Highlight["color"])
      ? (raw as Highlight["color"])
      : FALLBACK_COLOR;
  } catch {
    return FALLBACK_COLOR;
  }
}

export function setDefaultMarkColor(color: Highlight["color"]): void {
  try {
    localStorage.setItem(DEFAULT_COLOR_KEY, color);
  } catch {
    // Ignore persistence failures — the in-session ref still carries the value.
  }
}
