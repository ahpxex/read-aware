import { useLayoutEffect, useRef, useState } from "react";
import type { SelectionOverlayRect } from "../lib/selection-overlay";

const EDGE_PADDING = 10;
const MENU_OFFSET = 12;

type MenuPosition = { left: number; top: number };

/**
 * Position a floating menu against a selection/annotation anchor rect, kept
 * inside its container: centered over the anchor and placed above it, flipping
 * below when there isn't room. `containerRef` measures the bounds; `menuRef`
 * measures the menu. Both must be attached by the caller.
 */
export function useAnchoredMenuPosition(anchorRect: SelectionOverlayRect | null | undefined) {
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

    const containerWidth = container.offsetWidth;
    const containerHeight = container.offsetHeight;
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const anchorCenterX = anchorRect.left + anchorRect.width / 2;
    const preferredTop = anchorRect.top - menuHeight - MENU_OFFSET;
    const fallbackTop = anchorRect.top + anchorRect.height + MENU_OFFSET;

    const left = Math.min(
      Math.max(EDGE_PADDING, anchorCenterX - menuWidth / 2),
      Math.max(EDGE_PADDING, containerWidth - menuWidth - EDGE_PADDING),
    );

    const top =
      preferredTop >= EDGE_PADDING
        ? preferredTop
        : Math.min(
            fallbackTop,
            Math.max(EDGE_PADDING, containerHeight - menuHeight - EDGE_PADDING),
          );

    setPosition({ left, top });
  }, [anchorRect]);

  return { containerRef, menuRef, position };
}
