import { useMemo } from "react";
import { cn } from "@read-aware/ui/cn";
import { formatPercent, useTranslation } from "../../../i18n";
import { useProgressScrub } from "../hooks/useProgressScrub";
import {
  findMarkAt,
  pageAtFraction,
  type ProgressMark,
} from "../lib/reader-progress";

type ReaderProgressScrubberProps = {
  /** Reading position, 0..1; null while unknown (nothing has relocated yet). */
  fraction: number | null;
  /** Location count reported by the engine — the "page" the readout names. */
  totalPages?: number;
  /** Chapter marks: ticks along the track, and the label for a scrub target. */
  marks?: ProgressMark[];
  /** Absent (or no position) leaves the bar a plain, inert hairline. */
  onSeek?: (fraction: number) => void;
};

/** A keyboard step of one page, or 1% where the book reports no page count. */
const FALLBACK_STEP_FRACTION = 0.01;
/** Shift / PageUp / PageDown — a coarser sweep through the book. */
const PAGE_STEP_FRACTION = 0.05;

/**
 * The reading-progress bar merged into the reader header's bottom edge.
 *
 * At rest it is the hairline it has always been. Hovering it grows the line,
 * reveals chapter ticks, and floats a readout of the position under the
 * pointer; dragging scrubs, and releasing jumps there. The jump lands on
 * release rather than continuously — each seek loads a section, so following
 * the pointer would thrash the engine for positions the user is only passing
 * through.
 *
 * Interaction is deliberately opt-out of the header's window drag region: the
 * bar carries `data-tauri-drag-region="false"` so a press scrubs instead of
 * dragging the desktop window.
 */
export function ReaderProgressScrubber({
  fraction,
  totalPages = 0,
  marks = [],
  onSeek,
}: ReaderProgressScrubberProps) {
  const { t } = useTranslation("reader");
  const enabled = onSeek != null && fraction != null;
  const stepFraction = totalPages > 0 ? 1 / totalPages : FALLBACK_STEP_FRACTION;

  const scrub = useProgressScrub({
    fraction,
    enabled,
    stepFraction,
    pageStepFraction: PAGE_STEP_FRACTION,
    onSeek: onSeek ?? (() => {}),
  });

  const fillFraction = scrub.displayFraction ?? 0;
  const readoutFraction = scrub.pointerFraction;
  const chapterTicks = useMemo(
    () => marks.filter((mark) => mark.fraction > 0 && mark.fraction < 1),
    [marks],
  );
  const readoutMark =
    readoutFraction != null ? findMarkAt(marks, readoutFraction) : null;

  const describe = (value: number) => {
    const percent = formatPercent(value * 100);
    if (totalPages <= 0) return percent;
    return t("progress", {
      page: pageAtFraction(value, totalPages),
      total: totalPages,
      percent,
    });
  };

  const readoutPercent = readoutFraction != null ? readoutFraction * 100 : 0;
  // Keep the readout inside the header instead of half-hanging off its edges:
  // it anchors by its center in the middle of the track and by its near edge
  // at either end.
  const readoutAnchor =
    readoutPercent < 12 ? "start" : readoutPercent > 88 ? "end" : "center";

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0">
      {enabled && readoutFraction != null && (
        <div
          aria-hidden="true"
          className={cn(
            // No outline: the readout floats over the header's own surface, and
            // a border there reads as a stray box rather than a hovering label.
            "absolute bottom-3 max-w-[min(18rem,80%)] rounded-md bg-[var(--ra-main-surface-color)] px-2 py-1 shadow-[0_4px_16px_-6px_rgba(28,25,23,0.25)]",
            readoutAnchor === "center" && "-translate-x-1/2",
            readoutAnchor === "end" && "-translate-x-full",
          )}
          style={{ left: `${readoutPercent}%` }}
        >
          {readoutMark && (
            <span className="block truncate font-sans text-xs leading-tight text-fg">
              {readoutMark.label}
            </span>
          )}
          <span className="block truncate font-sans text-[11px] leading-tight tabular-nums text-fg-muted">
            {describe(readoutFraction)}
          </span>
        </div>
      )}

      <div
        {...(enabled
          ? {
              role: "slider",
              tabIndex: 0,
              "aria-label": t("readingPosition"),
              "aria-valuemin": 0,
              "aria-valuemax": 100,
              "aria-valuenow": Math.round((fraction ?? 0) * 100),
              "aria-valuetext": describe(fraction ?? 0),
              ...scrub.handleProps,
            }
          : {})}
        // Sized to end exactly where the header's 28px controls do, so the strip
        // never steals the bottom of a button's tap target. Pointer capture
        // carries a drag well past these 10px.
        className={cn(
          // No focus ring: a box drawn around a full-width 10px strip reads as a
          // stray border across the header. Focus shows in the bar itself — it
          // thickens and grows a knob, the same cue hovering gives.
          "group relative h-2.5 w-full",
          enabled && "pointer-events-auto cursor-pointer touch-none focus-visible:outline-none",
        )}
        data-tauri-drag-region="false"
      >
        {/* The track itself, anchored to the header's bottom edge. */}
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 bg-border/70 transition-[height] duration-150 ease-out group-focus-visible:h-1",
            scrub.active ? "h-1" : "h-0.5",
          )}
        >
          <div
            className={cn(
              // Same tone in hand as at rest: taking hold of the bar thickens
              // it and adds a knob, it does not darken the header.
              "h-full bg-fg-subtle",
              scrub.dragging ? "" : "transition-[width] duration-300",
            )}
            style={{ width: `${fillFraction * 100}%` }}
          />

          {/* Chapter boundaries — quiet, and only while the bar is in use. */}
          {chapterTicks.map((mark) => (
            <span
              key={`${mark.fraction}-${mark.label}`}
              aria-hidden="true"
              // The header's own background color, so a tick reads as a notch on
              // the filled and unfilled halves alike, in every reader theme.
              className={cn(
                "absolute inset-y-0 w-px bg-fill transition-opacity duration-150 group-focus-visible:opacity-100",
                scrub.active ? "opacity-100" : "opacity-0",
              )}
              style={{ left: `${mark.fraction * 100}%` }}
            />
          ))}
        </div>

        {/* Knob, centered on the track line and revealed with it. */}
        {enabled && (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute h-2 w-2 rounded-full bg-fg-muted transition-opacity duration-150 group-focus-visible:opacity-100",
              scrub.active ? "opacity-100" : "opacity-0",
            )}
            style={{
              left: `${fillFraction * 100}%`,
              bottom: "2px",
              transform: "translate(-50%, 50%)",
            }}
          />
        )}
      </div>
    </div>
  );
}
