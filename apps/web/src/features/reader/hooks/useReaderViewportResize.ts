import { useEffect, type RefObject } from "react";
import { causalActor, type DomainActor } from "../../../platform/domain-actor";

/** The outer viewport drives the responsive text measure. Foliate re-lays its
 * own content in the same frame; this applies the host's measure and drops a
 * selection whose highlight no longer matches the text, also in the observer
 * callback. A resize is the system's doing: whoever asked the window to change
 * gets the result from that command's receipt. */
export function useReaderViewportResize({
  viewportRef,
  selectionRef,
  clearSelection,
  applyMaxInlineSize,
}: {
  viewportRef: RefObject<HTMLElement | null>;
  selectionRef: RefObject<unknown>;
  clearSelection(origin: DomainActor): void;
  applyMaxInlineSize(origin: DomainActor): void;
}): void {
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    let width = element.clientWidth,
      height = element.clientHeight;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width && element.clientHeight === height) return;
      width = element.clientWidth;
      height = element.clientHeight;
      const origin = causalActor("system");
      if (selectionRef.current) clearSelection(origin);
      applyMaxInlineSize(origin);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewportRef, selectionRef, clearSelection, applyMaxInlineSize]);
}
