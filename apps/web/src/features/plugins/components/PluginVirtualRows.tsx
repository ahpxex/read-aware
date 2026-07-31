/**
 * Windowed rendering for plugin list bodies: a self-contained scroll region
 * that only mounts the rows near the viewport. A saved-word notebook with
 * thousands of entries would otherwise put every row in the DOM at once.
 *
 * The region owns its own scroll (rather than leaning on whichever ancestor
 * happens to scroll — that differs between the page host and the dialog host).
 * Its height fills from its top down to the smaller of the viewport bottom and
 * the nearest host scroll area's bottom, so it sits correctly inside a full
 * page and inside a height-capped dialog alike.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export type VirtualRow = {
  key: string;
  /** Estimated height in px before measurement — keep it close to real. */
  size: number;
  content: ReactNode;
};

const BOTTOM_GUTTER = 16;
const MIN_HEIGHT = 200;

function useFillHeight(ref: React.RefObject<HTMLElement | null>): number | undefined {
  const [maxHeight, setMaxHeight] = useState<number>();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top;
      const host = el.closest(".ra-scrollarea");
      const bottom = host
        ? Math.min(window.innerHeight, host.getBoundingClientRect().bottom)
        : window.innerHeight;
      setMaxHeight(Math.max(MIN_HEIGHT, Math.round(bottom - top - BOTTOM_GUTTER)));
    };
    measure();
    // Re-measure after layout settles and whenever the window resizes.
    const raf = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref]);
  return maxHeight;
}

export function PluginVirtualRows({ rows }: { rows: VirtualRow[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const maxHeight = useFillHeight(scrollRef);
  // Until the region's height is known the "viewport" is unbounded and the
  // window would be every row — exactly the full mount this component exists
  // to avoid. First commit renders the empty scroller (so it can be
  // measured); rows arrive on the second, bounded, commit.
  const ready = maxHeight !== undefined;

  const virtualizer = useVirtualizer({
    count: ready ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rows[index].size,
    getItemKey: (index) => rows[index].key,
    overscan: 8,
  });

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto overscroll-contain"
      style={{ maxHeight }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {rows[virtualRow.index].content}
          </div>
        ))}
      </div>
    </div>
  );
}
