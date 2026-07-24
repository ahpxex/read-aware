import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

const VIEWPORT_EDGE_GAP = 8;

type HorizontalAlignment = "left" | "right" | "center";

/** Keep an anchored floating surface inside the visible viewport horizontally. */
export function useHorizontalViewportCollision(
  open: boolean,
  align: HorizontalAlignment,
): {
  floatingRef: RefObject<HTMLDivElement | null>;
  positionStyle: CSSProperties;
} {
  const floatingRef = useRef<HTMLDivElement>(null);
  const appliedShiftRef = useRef(0);
  const [horizontalShift, setHorizontalShift] = useState(0);

  const updatePosition = useCallback(() => {
    const floating = floatingRef.current;
    if (!floating) return;

    const rect = floating.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportRight =
      viewportLeft + (viewport?.width ?? document.documentElement.clientWidth);
    const naturalLeft = rect.left - appliedShiftRef.current;
    const naturalRight = rect.right - appliedShiftRef.current;
    const availableWidth = viewportRight - viewportLeft - VIEWPORT_EDGE_GAP * 2;

    let nextShift = 0;
    if (rect.width > availableWidth || naturalLeft < viewportLeft + VIEWPORT_EDGE_GAP) {
      nextShift = viewportLeft + VIEWPORT_EDGE_GAP - naturalLeft;
    } else if (naturalRight > viewportRight - VIEWPORT_EDGE_GAP) {
      nextShift = viewportRight - VIEWPORT_EDGE_GAP - naturalRight;
    }

    appliedShiftRef.current = nextShift;
    setHorizontalShift((current) => (Math.abs(current - nextShift) < 0.5 ? current : nextShift));
  }, []);

  useLayoutEffect(() => {
    if (!open || !floatingRef.current) return;

    updatePosition();
    const floating = floatingRef.current;
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    resizeObserver?.observe(floating);
    // Overlay entrance animations temporarily scale the measured rect. Re-run
    // once the surface reaches its final size so the viewport gap is exact.
    floating.addEventListener("animationend", updatePosition);
    window.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("resize", updatePosition);

    return () => {
      resizeObserver?.disconnect();
      floating.removeEventListener("animationend", updatePosition);
      window.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("resize", updatePosition);
    };
  }, [align, open, updatePosition]);

  const positionStyle: CSSProperties =
    align === "right"
      ? { right: -horizontalShift }
      : align === "center"
        ? { left: `calc(50% + ${horizontalShift}px)` }
        : { left: horizontalShift };

  return { floatingRef, positionStyle };
}
