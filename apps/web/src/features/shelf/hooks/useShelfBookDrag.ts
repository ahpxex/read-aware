import { useEffect, useState } from "react";
import { dragCarriesBooks } from "../lib/book-drag";

/**
 * Whether an in-app book drag is in flight — drives the shelf's drag action
 * dock. Listens at the window so drags started by any card are seen; the flip
 * to active is deferred a tick because mutating the DOM under the dragged
 * element during `dragstart` aborts the drag in WebKit.
 */
export function useShelfBookDrag(): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let timer = 0;
    function onDragStart(event: DragEvent) {
      if (!dragCarriesBooks(event.dataTransfer)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setActive(true), 0);
    }
    // dragend fires on the source card after every outcome (drop or cancel),
    // window drop covers the source unmounting mid-drag.
    function onDragEnd() {
      window.clearTimeout(timer);
      setActive(false);
    }
    window.addEventListener("dragstart", onDragStart);
    window.addEventListener("dragend", onDragEnd);
    window.addEventListener("drop", onDragEnd);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("dragend", onDragEnd);
      window.removeEventListener("drop", onDragEnd);
    };
  }, []);

  return active;
}
