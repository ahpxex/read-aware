import { Trash } from "@phosphor-icons/react";
import { IconButton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import type { Highlight } from "../../annotations/lib/annotation-types";
import { useAnchoredMenuPosition } from "../hooks/useAnchoredMenuPosition";
import { HIGHLIGHT_COLORS } from "../lib/highlight-renderer";
import type { SelectionOverlayRect } from "../lib/selection-overlay";

type ReaderAnnotationMenuProps = {
  /** Anchor of the tapped highlight/underline, or null when nothing is active. */
  anchorRect: SelectionOverlayRect | null;
  activeColor: Highlight["color"];
  onRecolor: (color: Highlight["color"]) => void;
  onRemove: () => void;
};

const COLOR_OPTIONS: Highlight["color"][] = ["yellow", "green", "blue", "pink"];

/**
 * Recolor/remove menu for an existing mark. Tapping a highlight or underline in
 * the reader anchors this over it; the swatches recolor it (the current color is
 * ringed), and the trash button removes it.
 */
export function ReaderAnnotationMenu({
  anchorRect,
  activeColor,
  onRecolor,
  onRemove,
}: ReaderAnnotationMenuProps) {
  const { containerRef, menuRef, position } = useAnchoredMenuPosition(anchorRect);

  if (!anchorRect) return null;

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
    >
      <div
        ref={menuRef}
        className="ra-motion-overlay-pop pointer-events-auto absolute flex items-center gap-0.5 rounded-lg border border-border bg-[var(--ra-main-surface-color)] p-1 shadow-[0_4px_16px_-6px_rgba(28,25,23,0.25)]"
        style={position}
      >
        {COLOR_OPTIONS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Recolor ${color}`}
            title={color}
            onClick={() => onRecolor(color)}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-fg/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
          >
            <span
              className={cn(
                "block h-4 w-4 rounded-full ring-1 ring-inset",
                color === activeColor ? "ring-fg" : "ring-black/15 dark:ring-white/20",
              )}
              style={{ backgroundColor: HIGHLIGHT_COLORS[color] }}
            />
          </button>
        ))}
        <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />
        <IconButton
          label="Remove"
          title="Remove"
          size="sm"
          onClick={onRemove}
          className="rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg focus-visible:ring-fg"
          icon={<Trash size={14} weight="regular" aria-hidden="true" />}
        />
      </div>
    </div>
  );
}
