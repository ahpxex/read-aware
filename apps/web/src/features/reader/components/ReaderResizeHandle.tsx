import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@read-aware/ui/cn";

type ReaderResizeHandleProps = {
  /** Which edge of the panel the handle sits on. */
  edge: "left" | "right";
  ariaLabel: string;
  /** Incremental horizontal drag distance (px) since the last move. */
  onResize: (deltaPx: number) => void;
  /** Called on release, to persist the final width. */
  onCommit: () => void;
};

/**
 * A thin draggable divider on a panel's edge. Uses pointer capture so the drag
 * keeps tracking even when the cursor passes over the book's iframe; shows a
 * hairline accent on hover/drag.
 */
export function ReaderResizeHandle({
  edge,
  ariaLabel,
  onResize,
  onCommit,
}: ReaderResizeHandleProps) {
  const lastXRef = useRef(0);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    lastXRef.current = event.clientX;
    document.body.style.cursor = "col-resize";
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const delta = event.clientX - lastXRef.current;
    if (delta === 0) return;
    lastXRef.current = event.clientX;
    onResize(delta);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.cursor = "";
    onCommit();
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={cn(
        "group/resize absolute inset-y-0 z-20 w-2 cursor-col-resize touch-none",
        edge === "right" ? "-right-1" : "-left-1",
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/resize:bg-fg/25"
      />
    </div>
  );
}
