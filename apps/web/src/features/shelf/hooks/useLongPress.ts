import { useCallback, useEffect, useRef } from "react";

type LongPressOptions = {
  /** Hold duration before the press fires. */
  delayMs?: number;
  /** Finger travel beyond this cancels the press (it's a scroll/drag). */
  moveTolerancePx?: number;
};

/**
 * Long-press detection for touch (and pen) pointers. Returns handlers to
 * spread onto the pressable element; mouse input is ignored — desktop has
 * hover affordances for the same actions.
 *
 * After a press fires, the release still emits a click — `onClickCapture`
 * swallows exactly that one so the element's tap action doesn't also run.
 */
export function useLongPress(
  onLongPress: () => void,
  { delayMs = 450, moveTolerancePx = 10 }: LongPressOptions = {},
) {
  const timerRef = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;

  const cancel = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") return;
      cancel();
      firedRef.current = false;
      originRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        firedRef.current = true;
        onLongPressRef.current();
      }, delayMs);
    },
    [cancel, delayMs],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const origin = originRef.current;
      if (!origin || timerRef.current == null) return;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      if (Math.hypot(dx, dy) > moveTolerancePx) cancel();
    },
    [cancel, moveTolerancePx],
  );

  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (!firedRef.current) return;
    firedRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture,
  };
}
