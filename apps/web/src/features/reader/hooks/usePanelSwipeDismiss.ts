import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import {
  EDGE_BACK_ZONE_PX,
  lockSwipe,
  releaseVelocity,
  shouldDismiss,
  swipeOffset,
  type SwipeExit,
  type SwipeLock,
} from "../lib/panel-swipe";

/** How long the sheet takes to leave, or to settle back, after release. */
const SETTLE_MS = 200;

type Options = {
  /** The sheet is open. */
  open: boolean;
  /** Gestures apply (a phone sheet that is currently shown). */
  enabled: boolean;
  /** The side the sheet slides out to when it closes. */
  exit: Exclude<SwipeExit, "down">;
  /** Navigation pages accept only a rightward swipe from the left edge. */
  edgeOnly?: boolean;
  /** Changes when a back swipe reveals another page without closing the sheet. */
  navigationKey?: string | number | null;
  onDismiss: () => void;
};

type Gesture = {
  touchId: number;
  startX: number;
  startY: number;
  atEdge: boolean;
  target: Element | null;
  /** A drag here would fight text entry or an active selection. */
  guarded: boolean;
  lock: SwipeLock;
  width: number;
  offset: number;
  samples: { t: number; at: number }[];
};

function isTextEntry(target: Element | null): boolean {
  return !!target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
}

function hasSelectionIn(root: Element): boolean {
  const selection = root.ownerDocument.getSelection();
  return !!selection && !selection.isCollapsed && !!selection.anchorNode && root.contains(selection.anchorNode);
}

/** Whether something between the touch and the sheet scrolls sideways in this direction. */
function scrollsHorizontally(target: Element | null, root: Element, dx: number): boolean {
  for (let node = target; node && node !== root; node = node.parentElement) {
    if (node.scrollWidth <= node.clientWidth + 1) continue;
    const overflow = getComputedStyle(node).overflowX;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    // A finger moving left reveals content to the right, and vice versa.
    if (dx < 0 && node.scrollLeft + node.clientWidth < node.scrollWidth - 1) return true;
    if (dx > 0 && node.scrollLeft > 0) return true;
  }
  return false;
}

function clearInlineMotion(el: HTMLElement): void {
  el.style.transform = "";
  el.style.opacity = "";
  el.style.transition = "";
  el.style.willChange = "";
}

/**
 * Swipe-to-dismiss for a phone sheet (see lib/panel-swipe.ts for the
 * gesture rules). While a gesture holds the sheet, it moves by inline
 * transform. The sheet's own open/closed classes keep owning its resting
 * state, and the inline motion is cleared once that state has taken over.
 *
 * A back swipe can carry a sheet out to the right although its closed
 * position is on the left. It then leaves invisibly: the inline position is
 * held, faded out, until React commits the closed state, and only then is the
 * inline motion cleared without a transition (see the layout effect below).
 * Settings reuses this motion in edge-only mode: navigationKey clears the held
 * position when a deeper page returns to the list while the sheet stays open.
 */
export function usePanelSwipeDismiss<T extends HTMLElement>(
  ref: RefObject<T | null>,
  { open, enabled, exit, edgeOnly = false, navigationKey, onDismiss }: Options,
): void {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const awaitingClose = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !awaitingClose.current) return;
    awaitingClose.current = false;
    // The closed classes or the previous page are applied; drop the held
    // position without animating back across the screen.
    el.style.transition = "none";
    el.style.transform = "";
    el.style.opacity = "";
    void el.offsetWidth;
    el.style.transition = "";
    el.style.willChange = "";
  }, [open, navigationKey, ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || !open) return;
    let gesture: Gesture | null = null;
    let settling = false;
    let cancelSettle = () => {};

    const touchOf = (event: TouchEvent, id: number) =>
      Array.from(event.changedTouches).find((touch) => touch.identifier === id) ??
      Array.from(event.touches).find((touch) => touch.identifier === id);

    const settle = (to: number, done: () => void) => {
      cancelSettle();
      // Already there (released at rest, or dragged fully out): no transition
      // would run, so no transitionend would ever arrive.
      if (
        el.style.transform === `translateX(${to}px)` ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        done();
        return;
      }
      settling = true;
      const finish = (event?: TransitionEvent) => {
        if (event && (event.target !== el || event.propertyName !== "transform")) return;
        cancelSettle();
        done();
      };
      // A backgrounded WebView can omit transitionend. Never strand navigation.
      const timer = window.setTimeout(() => finish(), SETTLE_MS + 50);
      cancelSettle = () => {
        window.clearTimeout(timer);
        el.removeEventListener("transitionend", finish);
        el.removeEventListener("transitioncancel", finish);
        settling = false;
      };
      el.addEventListener("transitionend", finish);
      el.addEventListener("transitioncancel", finish);
      el.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      el.style.transform = `translateX(${to}px)`;
    };

    const onStart = (event: TouchEvent) => {
      // Native listeners do not receive events from portaled dialogs/menus.
      // Inline nested dialogs must likewise own their own gestures.
      const target = event.target instanceof Element ? event.target : null;
      if (target && (!el.contains(target) || target.closest('[role="dialog"]') !== el.closest('[role="dialog"]')))
        return;
      if (settling || event.touches.length !== 1) {
        if (gesture?.lock.kind === "edge-back" || gesture?.lock.kind === "drag") settle(0, () => clearInlineMotion(el));
        gesture = null;
        return;
      }
      const touch = event.touches[0];
      const atEdge = touch.clientX <= EDGE_BACK_ZONE_PX;
      if (edgeOnly && (!atEdge || isTextEntry(target) || hasSelectionIn(el))) return;
      gesture = {
        touchId: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        atEdge,
        target,
        guarded: isTextEntry(target) || hasSelectionIn(el),
        lock: { kind: "pending" },
        width: 0,
        offset: 0,
        samples: [],
      };
    };

    const onMove = (event: TouchEvent) => {
      const current = gesture;
      if (!current) return;
      if (event.touches.length !== 1) {
        gesture = null;
        if (current.lock.kind === "edge-back" || current.lock.kind === "drag") settle(0, () => clearInlineMotion(el));
        return;
      }
      const touch = touchOf(event, current.touchId);
      if (!touch) return;
      const dx = touch.clientX - current.startX;
      const dy = touch.clientY - current.startY;
      if (current.lock.kind === "pending") {
        const lock = lockSwipe(dx, dy, exit, current.atEdge);
        if (lock.kind === "pending") return;
        // The edge back swipe wins over the sheet's content, as it does in
        // iOS; an ordinary drag yields to text entry, selections and
        // anything that scrolls sideways under the finger.
        if (
          lock.kind === "release" ||
          (edgeOnly && lock.kind !== "edge-back") ||
          (lock.kind === "drag" && (current.guarded || scrollsHorizontally(current.target, el, dx)))
        ) {
          gesture = null;
          return;
        }
        current.lock = lock;
        current.width = el.getBoundingClientRect().width;
        el.style.transition = "none";
        el.style.willChange = "transform";
      }
      if (current.lock.kind !== "edge-back" && current.lock.kind !== "drag") return;
      event.preventDefault();
      current.offset = swipeOffset(dx, current.lock.direction);
      current.samples.push({ t: event.timeStamp, at: touch.clientX });
      el.style.transform = `translateX(${current.offset}px)`;
    };

    const onEnd = (event: TouchEvent) => {
      const current = gesture;
      if (!current || !touchOf(event, current.touchId)) return;
      gesture = null;
      if (current.lock.kind !== "edge-back" && current.lock.kind !== "drag") return;
      if (event.cancelable) event.preventDefault();
      const { direction } = current.lock;
      const leave =
        event.type === "touchend" &&
        shouldDismiss(current.offset, releaseVelocity(current.samples), current.width, direction);
      if (!leave) {
        settle(0, () => clearInlineMotion(el));
        return;
      }
      settle(direction * current.width, () => {
        // Hold the off-screen position, invisible, until the closed state
        // commits (the layout effect above clears it).
        el.style.transition = "none";
        el.style.opacity = "0";
        awaitingClose.current = true;
        dismissRef.current();
      });
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      cancelSettle();
      // Disabled mid-gesture (the chrome hid): let the classes take over.
      if (!awaitingClose.current) clearInlineMotion(el);
    };
  }, [open, enabled, exit, edgeOnly, navigationKey, ref]);
}
