import { useCallback, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
/** Double-click zoom-in target. */
const TOGGLE_SCALE = 2.5;

type Transform = { scale: number; x: number; y: number };

const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };

/**
 * Zoom + pan gestures for the image lightbox, over Pointer Events so mouse
 * drag and touch pinch share one implementation. The transform applies to a
 * center-origin element: translate(x, y) scale(s). Wheel (and trackpad pinch,
 * which arrives as ctrlKey+wheel) zooms around the cursor; one pointer pans
 * when zoomed; two pointers pinch; double-click toggles fit ↔ 2.5x.
 */
export function useZoomPan() {
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // Live pointers by id; two entries mean an active pinch.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchStartRef = useRef<{ distance: number; scale: number } | null>(null);
  // Whether the current pointer interaction panned (suppresses backdrop close).
  const movedRef = useRef(false);
  const transformRef = useRef(transform);
  transformRef.current = transform;

  /** Cursor position relative to the stage center — the transform's frame. */
  const toCenterFrame = useCallback((clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const rect = stage.getBoundingClientRect();
    return {
      x: clientX - rect.left - rect.width / 2,
      y: clientY - rect.top - rect.height / 2,
    };
  }, []);

  const applyScale = useCallback((nextScaleRaw: number, aroundClientX: number, aroundClientY: number) => {
    setTransform((current) => {
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScaleRaw));
      if (nextScale === 1) return IDENTITY;
      const cursor = toCenterFrame(aroundClientX, aroundClientY);
      // Keep the content point under the cursor stationary while scaling.
      const ratio = nextScale / current.scale;
      return {
        scale: nextScale,
        x: cursor.x - (cursor.x - current.x) * ratio,
        y: cursor.y - (cursor.y - current.y) * ratio,
      };
    });
  }, [toCenterFrame]);

  const onWheel = useCallback((event: ReactWheelEvent) => {
    event.stopPropagation();
    // Trackpad pinch reports ctrlKey with fine deltas; plain wheel zooms too —
    // a lightbox has nothing to scroll.
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002));
    applyScale(transformRef.current.scale * factor, event.clientX, event.clientY);
  }, [applyScale]);

  const onDoubleClick = useCallback((event: ReactPointerEvent | React.MouseEvent) => {
    event.stopPropagation();
    const { scale } = transformRef.current;
    applyScale(scale > 1.01 ? 1 : TOGGLE_SCALE, event.clientX, event.clientY);
  }, [applyScale]);

  const onPointerDown = useCallback((event: ReactPointerEvent) => {
    if (!event.isPrimary && pointersRef.current.size === 0) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    if (pointersRef.current.size === 1) movedRef.current = false;
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchStartRef.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        scale: transformRef.current.scale,
      };
    }
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent) => {
    const previous = pointersRef.current.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, next);

    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const [a, b] = [...pointersRef.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const start = pinchStartRef.current;
      if (start.distance > 0) {
        movedRef.current = true;
        applyScale(
          start.scale * (distance / start.distance),
          (a.x + b.x) / 2,
          (a.y + b.y) / 2,
        );
      }
      return;
    }

    // Single pointer: pan when zoomed in.
    if (transformRef.current.scale > 1) {
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      if (dx !== 0 || dy !== 0) movedRef.current = true;
      setTransform((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
    }
  }, [applyScale]);

  const onPointerEnd = useCallback((event: ReactPointerEvent) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchStartRef.current = null;
  }, []);

  const reset = useCallback(() => setTransform(IDENTITY), []);

  const style = useMemo<CSSProperties>(() => ({
    transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
    transformOrigin: "center center",
    transition: pointersRef.current.size > 0 ? undefined : "transform 120ms ease-out",
  }), [transform]);

  return {
    stageRef,
    style,
    zoomed: transform.scale > 1,
    /** True while/after the pointer interaction dragged — not a plain click. */
    movedRef,
    reset,
    handlers: {
      onWheel,
      onDoubleClick,
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
    },
  };
}
