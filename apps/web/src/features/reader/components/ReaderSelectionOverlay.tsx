import type { ReaderSelectionAppearance, ReaderSelectionState } from "../lib/selection-overlay";

type ReaderSelectionOverlayProps = {
  appearance: Extract<ReaderSelectionAppearance, "highlight" | "underline"> | null;
  selection: ReaderSelectionState | null;
};

export function ReaderSelectionOverlay({
  appearance,
  selection,
}: ReaderSelectionOverlayProps) {
  if (!selection?.rects.length) return null;
  if (!appearance) return null;

  const isUnderline = appearance === "underline";
  const fillColor =
    appearance === "highlight"
      ? "var(--ra-reader-selection-highlight-color)"
      : "var(--ra-reader-selection-color)";
  const accentColor = "var(--ra-reader-selection-accent-color)";

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
            backgroundColor: isUnderline ? "transparent" : fillColor,
            borderBottom: isUnderline ? `1.5px solid ${accentColor}` : undefined,
          }}
        />
      ))}
    </div>
  );
}
