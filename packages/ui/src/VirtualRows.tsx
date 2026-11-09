/**
 * Windowed rendering for long lists: only the rows near the viewport are
 * mounted. A saved-word notebook, or a table of contents with tens of
 * thousands of entries, would otherwise put every row in the DOM at once.
 *
 * The list does NOT own a scroll region. It virtualizes against the nearest
 * host `.ra-scrollarea` — the app viewport on a plugin page, the bounded
 * body of a Dialog or header popup — so scrolling always belongs to the
 * surface and its scrollbar sits at that surface's edge, never on a floating
 * inner box in the middle of the page.
 */
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export type VirtualRow = {
  key: string;
  /** Estimated height in px before measurement — keep it close to real. */
  size: number;
  content: ReactNode;
};

export type VirtualRowsHandle = {
  /** Bring a row into view — mounted or not — e.g. the current chapter of a contents list. */
  scrollToIndex(index: number, align?: "start" | "center" | "end" | "auto"): void;
  /** The key of the first row at least partly in view — where to come back to later. */
  topRowKey(): string | null;
  /**
   * Bring the row with this key into view, as scrollToIndex does. A key is
   * stable where an index is not (rows above it may have come or gone since).
   * Returns false when no row has the key.
   */
  scrollToKey(key: string, align?: "start" | "center" | "end" | "auto"): boolean;
};

export const VirtualRows = forwardRef<VirtualRowsHandle, { rows: VirtualRow[] }>(function VirtualRows({ rows }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  // The list's offset within the scroller's CONTENT (viewport-invariant), so
  // row positions can be expressed relative to the container itself.
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const host = el.closest<HTMLElement>(".ra-scrollarea");
    setScroller(host);
    if (!host) return;
    const measure = () => {
      const margin = el.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop;
      setScrollMargin(Math.max(0, Math.round(margin)));
    };
    measure();
    // Content above the list (search fields, tab strips, forms) can resize
    // after mount; the margin must follow or rows land offset. Growth above
    // never resizes the scroll HOST itself (its box is viewport-bound), but
    // it always resizes some ancestor between the list and the host — so
    // observe that whole chain.
    const raf = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    for (let node: HTMLElement | null = el; node && node !== host; node = node.parentElement) {
      observer.observe(node);
    }
    observer.observe(host);
    observer.observe(document.documentElement);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [rows.length]);

  // Until the host scroller is resolved the "viewport" would be unbounded and
  // the window every row — exactly the full mount this component exists to
  // avoid. First commit renders the empty container (so it can be measured);
  // rows arrive on the second, bounded, commit.
  const virtualizer = useVirtualizer({
    count: scroller ? rows.length : 0,
    getScrollElement: () => scroller,
    estimateSize: (index) => rows[index].size,
    getItemKey: (index) => rows[index].key,
    overscan: 8,
    scrollMargin,
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (index, align = "auto") => {
        if (index >= 0 && index < rows.length) virtualizer.scrollToIndex(index, { align });
      },
      topRowKey: () => {
        // Row positions are in the scroller's content coordinates, as is its offset.
        const offset = virtualizer.scrollOffset ?? 0;
        const top = virtualizer.getVirtualItems().find((item) => item.end > offset);
        return top ? (rows[top.index]?.key ?? null) : null;
      },
      scrollToKey: (key, align = "auto") => {
        const index = rows.findIndex((row) => row.key === key);
        if (index < 0) return false;
        virtualizer.scrollToIndex(index, { align });
        return true;
      },
    }),
    [virtualizer, rows],
  );

  return (
    <div ref={containerRef}>
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
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
            }}
          >
            {rows[virtualRow.index].content}
          </div>
        ))}
      </div>
    </div>
  );
});

VirtualRows.displayName = "VirtualRows";
