import { useLayoutEffect, useRef, useState } from "react";
import type { SelectionOverlayRect } from "../lib/selection-overlay";

const EDGE_PADDING = 10;
const MENU_OFFSET = 12;

type MenuPosition = { left: number; top: number };

/**
 * Position a floating menu against a selection/annotation anchor rect, kept
 * inside its container: centered on the anchor and placed above it (or below,
 * with `prefer: "below"`), flipping to the other side when there isn't room.
 * `containerRef` measures the bounds; `menuRef` measures the menu. Both must be
 * attached by the caller. The position follows the menu's own size too, so a
 * surface that grows (a note card as its text wraps) stays inside the bounds.
 */
export function useAnchoredMenuPosition(
  anchorRect: SelectionOverlayRect | null | undefined,
  { prefer = "above" }: { prefer?: "above" | "below" } = {},
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<MenuPosition>({
    left: EDGE_PADDING,
    top: EDGE_PADDING,
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    const menu = menuRef.current;
    if (!container || !menu || !anchorRect) return;

    const place = () => {
      const containerWidth = container.offsetWidth;
      const containerHeight = container.offsetHeight;
      const menuWidth = menu.offsetWidth;
      const menuHeight = menu.offsetHeight;
      const anchorCenterX = anchorRect.left + anchorRect.width / 2;
      const above = anchorRect.top - menuHeight - MENU_OFFSET;
      const below = anchorRect.top + anchorRect.height + MENU_OFFSET;
      const fitsAbove = above >= EDGE_PADDING;
      const fitsBelow = below + menuHeight <= containerHeight - EDGE_PADDING;
      const lowest = Math.max(EDGE_PADDING, containerHeight - menuHeight - EDGE_PADDING);

      const left = Math.min(
        Math.max(EDGE_PADDING, anchorCenterX - menuWidth / 2),
        Math.max(EDGE_PADDING, containerWidth - menuWidth - EDGE_PADDING),
      );
      const top =
        prefer === "below"
          ? fitsBelow || !fitsAbove
            ? Math.min(below, lowest)
            : above
          : fitsAbove
            ? above
            : Math.min(below, lowest);

      setPosition((current) => (current.left === left && current.top === top ? current : { left, top }));
    };

    place();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(menu);
    return () => observer.disconnect();
  }, [anchorRect, prefer]);

  return { containerRef, menuRef, position };
}
