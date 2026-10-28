import { useEffect, useRef, useState, type RefObject } from "react";
import type { HeaderFooterItem, HeaderFooterPosition } from "../../../domain/settings/header-footer-settings";

export type HfDragTarget = {
  zone: HeaderFooterPosition | "hidden";
  beforeItem: HeaderFooterItem | null;
};

export type HfDragState = {
  item: HeaderFooterItem;
  x: number;
  y: number;
  target: HfDragTarget | null;
};

const DRAG_THRESHOLD_PX = 4;

function resolveTarget(x: number, y: number): HfDragTarget | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const chipEl = el.closest?.("[data-hf-item]") as HTMLElement | null;
  const zoneEl = (chipEl ?? el).closest?.("[data-hf-zone]") as HTMLElement | null;
  if (!zoneEl) return null;
  const zone = zoneEl.dataset.hfZone as HeaderFooterPosition | "hidden";
  if (chipEl && zone !== "hidden" && zoneEl.contains(chipEl)) {
    const rect = chipEl.getBoundingClientRect();
    const beforeItem = x < rect.left + rect.width / 2 ? (chipEl.dataset.hfItem as HeaderFooterItem) : null;
    if (beforeItem) return { zone, beforeItem };
    // Right half: insert after this chip — before its next sibling item.
    let next = chipEl.nextElementSibling as HTMLElement | null;
    while (next && !next.dataset.hfItem) next = next.nextElementSibling as HTMLElement | null;
    return { zone, beforeItem: (next?.dataset.hfItem as HeaderFooterItem) ?? null };
  }
  return { zone, beforeItem: null };
}

/**
 * Pointer-event drag for the header/footer editor. A press past ~4px on a
 * chip starts the drag; the chip follows via a fixed ghost; pointerup
 * commits; cancel and Escape abort. The pointerdown listener lives on the
 * editor root so only presses inside the editor count; tracking listeners go
 * on document so the drag survives leaving it. Pointer capture and React's
 * delegated events are both unreliable inside the settings dialog — native
 * listeners are not.
 */
export function useHeaderFooterDrag(
  rootRef: RefObject<HTMLElement | null>,
  onCommit: (item: HeaderFooterItem, target: HfDragTarget) => void,
) {
  const [active, setActive] = useState<HfDragState | null>(null);
  const pending = useRef<{ item: HeaderFooterItem; pointerId: number; x0: number; y0: number } | null>(null);
  const current = useRef<HfDragState | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const detach = useRef<(() => void) | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const end = (commit: boolean) => {
      detach.current?.();
      detach.current = null;
      const drag = pending.current;
      pending.current = null;
      const state = current.current;
      current.current = null;
      setActive(null);
      if (commit && drag && state?.target) commitRef.current(drag.item, state.target);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const chipEl = (e.target as Element | null)?.closest?.("[data-hf-item]") as HTMLElement | null;
      if (!chipEl || !root.contains(chipEl)) return;
      const item = chipEl.dataset.hfItem as HeaderFooterItem;
      detach.current?.();
      pending.current = { item, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY };
      const move = (ev: PointerEvent) => {
        const drag = pending.current;
        if (!drag || ev.pointerId !== drag.pointerId) return;
        if (!current.current) {
          const dx = ev.clientX - drag.x0;
          const dy = ev.clientY - drag.y0;
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        }
        const next: HfDragState = {
          item: drag.item,
          x: ev.clientX,
          y: ev.clientY,
          target: resolveTarget(ev.clientX, ev.clientY),
        };
        current.current = next;
        setActive(next);
      };
      const up = (ev: PointerEvent) => {
        if (pending.current?.pointerId !== ev.pointerId) return;
        end(true);
      };
      const cancel = () => end(false);
      const key = (ev: KeyboardEvent) => {
        // Escape aborts the drag — and only the drag, so the dialog stays open.
        if (ev.key === "Escape" && pending.current) {
          ev.preventDefault();
          ev.stopPropagation();
          end(false);
        }
      };
      document.addEventListener("pointermove", move, { capture: true });
      document.addEventListener("pointerup", up, { capture: true });
      document.addEventListener("pointercancel", cancel, { capture: true });
      document.addEventListener("keydown", key, { capture: true });
      detach.current = () => {
        document.removeEventListener("pointermove", move, { capture: true });
        document.removeEventListener("pointerup", up, { capture: true });
        document.removeEventListener("pointercancel", cancel, { capture: true });
        document.removeEventListener("keydown", key, { capture: true });
      };
    };
    root.addEventListener("pointerdown", down);
    return () => {
      detach.current?.();
      root.removeEventListener("pointerdown", down);
    };
  }, [rootRef]);

  return {
    draggingItem: active?.item ?? null,
    ghost: active,
    dropTarget: active?.target ?? null,
  };
}
