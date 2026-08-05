import { useLayoutEffect, useRef, useState } from "react";

/** Uniform header icon geometry: size-sm IconButton + the cluster's gap. */
const ITEM_WIDTH = 32;
const ITEM_GAP = 6;
const DOTS_WIDTH = 32;
/** Breathing room so items collapse a step before they would touch. */
const SAFETY_MARGIN = 12;

/**
 * How many utility icons fit beside the primary navigation. The navigation is
 * canonical — it always renders at its natural width — so when the window
 * narrows it is the ICON CLUSTER that yields: trailing icons collapse into
 * the dots overflow menu, one by one, priority-plus style.
 *
 * Capacity is derived arithmetically from the fixed geometry above rather
 * than by measuring the cluster itself, so the answer never depends on its
 * own outcome (no resize feedback loop). Observed: the header container, the
 * fixed left-side content, and the navigation's natural width.
 */
export function useHeaderClusterCapacity(itemCount: number) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fixedLeftRef = useRef<HTMLSpanElement | null>(null);
  const navBoxRef = useRef<HTMLDivElement | null>(null);
  /** Uncollapsible cluster content (a surface's contextual actions). */
  const auxFixedRef = useRef<HTMLSpanElement | null>(null);
  const rightSpacerRef = useRef<HTMLDivElement | null>(null);
  const [capacity, setCapacity] = useState(itemCount);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const styles = getComputedStyle(container);
      const content =
        container.clientWidth -
        parseFloat(styles.paddingLeft) -
        parseFloat(styles.paddingRight);
      const fixedLeft = fixedLeftRef.current?.getBoundingClientRect().width ?? 0;
      const navBox = navBoxRef.current;
      // scrollWidth, not clientWidth: the nav's NATURAL width, even while the
      // center track is momentarily clipping it.
      const nav = navBox ? Math.max(navBox.scrollWidth, navBox.clientWidth) : 0;
      const auxFixed = auxFixedRef.current?.getBoundingClientRect().width ?? 0;
      const rightSpacer =
        rightSpacerRef.current?.getBoundingClientRect().width ?? 0;

      const available =
        content -
        fixedLeft -
        nav -
        auxFixed -
        rightSpacer -
        DOTS_WIDTH -
        SAFETY_MARGIN;
      const fits = Math.floor((available + ITEM_GAP) / (ITEM_WIDTH + ITEM_GAP));
      const next = Math.max(0, Math.min(itemCount, fits));
      setCapacity((current) => (current === next ? current : next));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    for (const ref of [fixedLeftRef, navBoxRef, auxFixedRef]) {
      if (ref.current) observer.observe(ref.current);
    }
    return () => observer.disconnect();
  }, [itemCount]);

  return {
    containerRef,
    fixedLeftRef,
    navBoxRef,
    auxFixedRef,
    rightSpacerRef,
    capacity,
  };
}
