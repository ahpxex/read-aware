import type { RefObject } from "react";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { useDraggableFloat } from "../hooks/useDraggableFloat";
import { useSessionTimer } from "../hooks/useSessionTimer";
import type { TextUnitProgress } from "../hooks/useTextUnitNavigator";

type TextUnitReadoutChipProps = {
  visible: boolean;
  /** Coordinate space the chip floats in when dragged (the reader root). */
  containerRef: RefObject<HTMLElement | null>;
  /** Position within the loaded section, from the navigator. */
  progress: TextUnitProgress | null;
  /** Plugin-settings readout toggles. Both off → the chip never renders. */
  showProgress: boolean;
  sessionTimer: boolean;
};

/**
 * The text-unit mode's passive readouts — section position and session
 * clock — as their own quiet floating chip, so the navigator bar stays a
 * pure control strip (it is already width-constrained on phones). Defaults
 * to the top-right of the reader; draggable anywhere, and the spot sticks
 * per device under its own float id.
 */
export function TextUnitReadoutChip({
  visible,
  containerRef,
  progress,
  showProgress,
  sessionTimer,
}: TextUnitReadoutChipProps) {
  const { t } = useTranslation("reader");
  // The clock runs per mode entry (chip visibility) and is never persisted.
  const sessionElapsed = useSessionTimer(visible && sessionTimer);
  const float = useDraggableFloat({ containerRef, controlId: "navigator-readouts" });

  if (!visible) return null;
  const progressText =
    showProgress && progress ? `${progress.ordinal + 1} / ${progress.total}` : null;
  if (!progressText && !sessionElapsed) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div
        className={
          float.style
            ? "absolute w-max max-w-full -translate-x-1/2 -translate-y-1/2"
            : "absolute right-4 top-[calc(0.875rem+var(--ra-safe-top))] flex justify-end"
        }
        style={float.style ?? undefined}
      >
        <div
          role="status"
          data-ra-float
          {...float.handleProps}
          className={cn(
            "ra-motion-overlay-pop pointer-events-auto flex cursor-grab touch-none select-none items-center gap-2 rounded-md border border-border bg-[var(--ra-main-surface-color)] px-2.5 py-1 text-caption tabular-nums text-fg-subtle shadow-[0_4px_16px_-6px_rgba(28,25,23,0.25)]",
            float.dragging && "cursor-grabbing text-fg",
          )}
        >
          {progressText && (
            <span aria-label={`${t("textUnitMode.progress")}: ${progressText}`}>
              {progressText}
            </span>
          )}
          {progressText && sessionElapsed && (
            <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border" />
          )}
          {sessionElapsed && (
            <span aria-label={`${t("textUnitMode.sessionTime")}: ${sessionElapsed}`}>
              {sessionElapsed}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
