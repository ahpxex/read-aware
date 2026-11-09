import { useLayoutEffect, useState } from "react";

/**
 * Narrowest toolbar slot: the platform's minimum touch target. A 393pt phone
 * fits eight; the smallest (320pt), seven.
 */
const MIN_SLOT_PX = 44;

/**
 * How many equal slots fit across a phone bottom toolbar. The row spans the
 * toolbar's full width whatever it contains, so measuring it never feeds back
 * into its own answer.
 */
export function useToolbarSlotCapacity(active: boolean) {
  // A callback ref, so the measurement follows the row element itself: the
  // toolbar mounts only at phone widths, possibly after this hook's first run,
  // and moves between the bottom bar and the top bar with its placement.
  const [row, rowRef] = useState<HTMLDivElement | null>(null);
  const [capacity, setCapacity] = useState(0);

  useLayoutEffect(() => {
    if (!active || !row) return;
    const measure = () => {
      // The content box: the row pads itself clear of the screen edges.
      const style = getComputedStyle(row);
      const width = row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const next = Math.floor(width / MIN_SLOT_PX);
      setCapacity((current) => (current === next ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [active, row]);

  return { rowRef, capacity };
}
