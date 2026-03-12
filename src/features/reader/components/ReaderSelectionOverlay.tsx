import type { SelectionOverlayRect } from "../lib/selection-overlay";

export type ReaderSelectionState = {
  anchorRect: SelectionOverlayRect | null;
  cfiRange: string | null;
  chapterHref: string | null;
  rects: SelectionOverlayRect[];
  text: string;
};

type ReaderSelectionOverlayProps = {
  selection: ReaderSelectionState | null;
};

export function ReaderSelectionOverlay({ selection }: ReaderSelectionOverlayProps) {
  if (!selection?.rects.length) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {selection.rects.map((rect, index) => (
        <div
          key={`${rect.left}-${rect.top}-${rect.width}-${rect.height}-${index}`}
          className="absolute rounded-[2px]"
          style={{
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            backgroundColor: "var(--ra-reader-selection-color)",
          }}
        />
      ))}
    </div>
  );
}
