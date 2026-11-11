import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "../../settings";
import { lockSwipe, releaseVelocity, shouldDismiss, swipeOffset, type SwipeLock } from "../lib/panel-swipe";

/** How long the drawer takes to close, or to settle back open, after release. */
const SETTLE_MS = 200;

type Options = {
  /** The drawer is open. */
  open: boolean;
  onDismiss: () => void;
};

type Gesture = {
  touchId: number;
  startX: number;
  startY: number;
  /** What a downward move would scroll instead, if it is not at its top. */
  scroller: Element | null;
  guarded: boolean;
  lock: SwipeLock;
  height: number;
  offset: number;
  samples: { t: number; at: number }[];
};

function isTextEntry(target: Element | null): boolean {
  return !!target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
}

/** The nearest element between the touch and the drawer that scrolls vertically. */
function verticalScroller(target: Element | null, root: Element): Element | null {
  for (let node = target; node && node !== root; node = node.parentElement) {
    if (node.scrollHeight <= node.clientHeight + 1) continue;
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

/**
 * Pull-down-to-close for the phone bottom bar's drawer (the grid-rows
 * container that grows the bar; see ReaderBottomBar). A downward drag that
 * starts on the drawer shrinks it with the finger: the bar is anchored to the
 * bottom, so its top edge, and the drawer's content with it, follows the
 * finger down while the icon row stays put. Released far or fast enough, it
 * closes; otherwise it settles back open. As in an iOS sheet, a drag inside a
 * list that is scrolled down scrolls the list instead.
 *
 * The drag drives an inline height, which the open/closed classes take back
 * over once the drawer's state catches up: a drawer dragged shut holds its
 * zero height until it next opens, while its closed class runs out the
 * collapse transition the bar listens for.
 */
export function useDrawerDragDismiss<T extends HTMLElement>(
  ref: RefObject<T | null>,
  { open, onDismiss }: Options,
): void {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  // A drag closed the drawer and its zero height is held until it next
  // opens. Only the open branch below clears this: the drag effect's cleanup
  // runs after the layout effect on the same commit and must still see it.
  const heldShut = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) {
      // Whatever a previous drag left behind, the open class owns the size.
      heldShut.current = false;
      el.style.height = "";
      el.style.transition = "";
      return;
    }
    if (!heldShut.current) return;
    // Closed: hand transitions back to the classes (the collapse the bar
    // waits on runs, unseen, under the held zero height).
    el.style.transition = "";
  }, [open, ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !open) return;
    let gesture: Gesture | null = null;
    // The in-flight settle's transition listener, while one runs.
    let settling: ((event: TransitionEvent) => void) | null = null;
    const stopSettling = () => {
      if (!settling) return;
      el.removeEventListener("transitionend", settling);
      el.removeEventListener("transitioncancel", settling);
      settling = null;
    };

    const touchOf = (event: TouchEvent, id: number) =>
      Array.from(event.changedTouches).find((touch) => touch.identifier === id) ??
      Array.from(event.touches).find((touch) => touch.identifier === id);

    const settle = (to: number, done: () => void) => {
      if (el.style.height === `${to}px`) {
        done();
        return;
      }
      // Reduced motion: the drawer lands at once, and no transition will run
      // to report a transitionend.
      if (prefersReducedMotion()) {
        el.style.height = `${to}px`;
        done();
        return;
      }
      const finish = (event: TransitionEvent) => {
        if (event.target !== el || event.propertyName !== "height") return;
        stopSettling();
        done();
      };
      settling = finish;
      el.addEventListener("transitionend", finish);
      el.addEventListener("transitioncancel", finish);
      el.style.transition = `height ${SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      el.style.height = `${to}px`;
    };

    const restore = () => {
      el.style.height = "";
      el.style.transition = "";
    };

    const onStart = (event: TouchEvent) => {
      if (settling || event.touches.length !== 1) {
        gesture = null;
        return;
      }
      const touch = event.touches[0];
      const target = event.target instanceof Element ? event.target : null;
      const selection = el.ownerDocument.getSelection();
      gesture = {
        touchId: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        scroller: verticalScroller(target, el),
        guarded:
          isTextEntry(target) ||
          (!!selection && !selection.isCollapsed && !!selection.anchorNode && el.contains(selection.anchorNode)),
        lock: { kind: "pending" },
        height: 0,
        offset: 0,
        samples: [],
      };
    };

    const onMove = (event: TouchEvent) => {
      const current = gesture;
      if (!current) return;
      if (event.touches.length !== 1) {
        gesture = null;
        if (current.lock.kind === "drag") settle(current.height, restore);
        return;
      }
      const touch = touchOf(event, current.touchId);
      if (!touch) return;
      const dy = touch.clientY - current.startY;
      if (current.lock.kind === "pending") {
        const lock = lockSwipe(touch.clientX - current.startX, dy, "down", false);
        if (lock.kind === "pending") return;
        if (lock.kind !== "drag" || current.guarded || (current.scroller && current.scroller.scrollTop > 0)) {
          gesture = null;
          return;
        }
        current.lock = lock;
        current.height = el.getBoundingClientRect().height;
        el.style.transition = "none";
      }
      if (current.lock.kind !== "drag") return;
      event.preventDefault();
      current.offset = swipeOffset(dy, 1);
      current.samples.push({ t: event.timeStamp, at: touch.clientY });
      el.style.height = `${Math.max(0, current.height - current.offset)}px`;
    };

    const onEnd = (event: TouchEvent) => {
      const current = gesture;
      if (!current || !touchOf(event, current.touchId)) return;
      gesture = null;
      if (current.lock.kind !== "drag") return;
      const leave =
        event.type === "touchend" && shouldDismiss(current.offset, releaseVelocity(current.samples), current.height, 1);
      if (!leave) {
        settle(current.height, restore);
        return;
      }
      settle(0, () => {
        // Hold the zero height until the closed state commits (the layout
        // effect above hands transitions back to the classes).
        el.style.transition = "none";
        heldShut.current = true;
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
      stopSettling();
      // Closed some other way mid-gesture or mid-settle: let the classes
      // take over. (A drag that closed it holds its zero height instead.)
      if (!heldShut.current) restore();
    };
  }, [open, ref]);
}
