import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from "react";
import {
  readFloatPosition,
  writeFloatPosition,
  type FloatPosition,
} from "../lib/text-unit-mode-state";

// A pointer that travels this far is a drag; anything shorter stays a tap, so
// buttons inside the floating control keep their click behaviour.
const DRAG_START_THRESHOLD_PX = 6;
// Keep at least this much of the control's center away from the container edge
// so a drag can never strand it beyond reach.
const EDGE_MARGIN_PX = 24;

export type DraggableFloat = {
  /** Center position as fractions of the container; null = untouched default. */
  position: FloatPosition | null;
  /** Inline `left`/`top` for the floating wrapper (pair with a centering translate). */
  style: CSSProperties | null;
  /** Spread onto the drag handle (which may be the control itself). */
  handleProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  };
  dragging: boolean;
  /**
   * True once, right after a pointer sequence that dragged — call from `click`
   * handlers on the control to swallow the click the drag's release synthesizes.
   */
  consumeDragClick: () => boolean;
};

type UseDraggableFloatOptions = {
  /** Coordinate space the control floats in (the reader root). */
  containerRef: RefObject<HTMLElement | null>;
  /** Persistence key; the dragged position is remembered per control. */
  controlId: string;
  /** Without a stored/dragged position the control keeps its default CSS spot. */
  defaultPosition?: FloatPosition | null;
};

/**
 * Free-form dragging for a floating reader control. The position is the
 * control's center, stored as fractions of the container so it survives
 * resizes and rotation, clamped so the control always stays reachable.
 */
export function useDraggableFloat({
  containerRef,
  controlId,
  defaultPosition = null,
}: UseDraggableFloatOptions): DraggableFloat {
  const [position, setPosition] = useState<FloatPosition | null>(
    () => readFloatPosition(controlId) ?? defaultPosition,
  );
  const [dragging, setDragging] = useState(false);
  const dragClickRef = useRef(false);
  const positionRef = useRef(position);
  positionRef.current = position;
  // Half-extent of the control, captured when a drag starts, so clamping can
  // keep the whole control inside the container (not just its center point).
  const halfSizeRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const clampToContainer = useCallback(
    (centerX: number, centerY: number): FloatPosition | null => {
      const container = containerRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const half = halfSizeRef.current;
      // A control wider than the container still clamps sanely: the min bound
      // wins, pinning it to the leading edge.
      const minX = Math.min(Math.max(half.x, EDGE_MARGIN_PX), rect.width / 2);
      const minY = Math.min(Math.max(half.y, EDGE_MARGIN_PX), rect.height / 2);
      const x = Math.min(rect.width - minX, Math.max(minX, centerX));
      const y = Math.min(rect.height - minY, Math.max(minY, centerY));
      return { x: x / rect.width, y: y / rect.height };
    },
    [containerRef],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
      const container = containerRef.current;
      if (!container) return;
      const handle = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      // Where the control's center sits right now, so the grab keeps its offset
      // (dragging by a corner shouldn't snap the center under the finger).
      const controlRect = (
        handle.closest("[data-ra-float]") ?? handle
      ).getBoundingClientRect();
      const grabOffsetX = startX - (controlRect.left + controlRect.width / 2);
      const grabOffsetY = startY - (controlRect.top + controlRect.height / 2);
      halfSizeRef.current = { x: controlRect.width / 2, y: controlRect.height / 2 };
      let started = false;

      const onMove = (move: globalThis.PointerEvent) => {
        if (move.pointerId !== pointerId) return;
        if (!started) {
          if (
            Math.abs(move.clientX - startX) < DRAG_START_THRESHOLD_PX &&
            Math.abs(move.clientY - startY) < DRAG_START_THRESHOLD_PX
          ) {
            return;
          }
          started = true;
          setDragging(true);
          try {
            handle.setPointerCapture(pointerId);
          } catch {
            // Capture is best-effort; window listeners still track the pointer.
          }
        }
        move.preventDefault();
        const containerRect = container.getBoundingClientRect();
        const next = clampToContainer(
          move.clientX - grabOffsetX - containerRect.left,
          move.clientY - grabOffsetY - containerRect.top,
        );
        if (next) setPosition(next);
      };

      const onEnd = (end: globalThis.PointerEvent) => {
        if (end.pointerId !== pointerId) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        if (!started) return;
        setDragging(false);
        // Swallow the click this release synthesizes, then re-arm.
        dragClickRef.current = true;
        window.setTimeout(() => {
          dragClickRef.current = false;
        }, 0);
        const settled = positionRef.current;
        if (settled) writeFloatPosition(controlId, settled);
      };

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    },
    [clampToContainer, containerRef, controlId],
  );

  // Re-clamp a stored position that a resize/rotation pushed out of reach.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const current = positionRef.current;
      if (!current) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const next = clampToContainer(current.x * rect.width, current.y * rect.height);
      if (next && (next.x !== current.x || next.y !== current.y)) setPosition(next);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [clampToContainer, containerRef]);

  const consumeDragClick = useCallback(() => {
    const wasDrag = dragClickRef.current;
    dragClickRef.current = false;
    return wasDrag;
  }, []);

  return {
    position,
    style: position
      ? { left: `${position.x * 100}%`, top: `${position.y * 100}%` }
      : null,
    handleProps: { onPointerDown },
    dragging,
    consumeDragClick,
  };
}
