import type { Highlight } from "./annotation-types";

/**
 * Sticky annotation preferences in device-local KV. The default mark colour
 * is the colour new one-click highlights/underlines use; it follows the last
 * colour the reader applied via the recolor menu.
 */

import { localKV } from "../../../platform/local-store";

export const DEFAULT_COLOR_KEY = "read-aware-default-mark-color";
export const MARK_COLORS: Highlight["color"][] = ["yellow", "green", "blue", "pink"];
const FALLBACK_COLOR: Highlight["color"] = "yellow";

export function getDefaultMarkColor(): Highlight["color"] {
  try {
    const raw = localKV.getItem(DEFAULT_COLOR_KEY);
    return MARK_COLORS.includes(raw as Highlight["color"])
      ? (raw as Highlight["color"])
      : FALLBACK_COLOR;
  } catch {
    return FALLBACK_COLOR;
  }
}

export function setDefaultMarkColor(color: Highlight["color"]): Promise<void> {
  return localKV.setItemAsync(DEFAULT_COLOR_KEY, color);
}
