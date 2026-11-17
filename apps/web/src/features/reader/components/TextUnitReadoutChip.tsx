import type { RefObject } from "react";
import { Button } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useLocale, useTranslation } from "../../../i18n";
import { useDraggableFloat } from "../hooks/useDraggableFloat";
import { useSessionTimer } from "../hooks/useSessionTimer";
import type { TextUnitProgress } from "../hooks/useTextUnitNavigator";
import type { ActiveReadingClock } from "../lib/reading-session-policy";

type TextUnitReadoutChipProps = {
  visible: boolean;
  /** Coordinate space the chip floats in when dragged (the reader root). */
  containerRef: RefObject<HTMLElement | null>;
  /** Position within the loaded section, from the navigator. */
  progress: TextUnitProgress | null;
  /** Plugin-settings readout toggles. Both off → the chip never renders. */
  showProgress: boolean;
  sessionTimer: boolean;
  /** The open book's reading clock; the session timer counts on it. */
  readingClock: ActiveReadingClock | null;
};

/**
 * The text-unit mode's readouts — section position and session
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
  readingClock,
}: TextUnitReadoutChipProps) {
  const { t } = useTranslation("reader");
  const locale = useLocale();
  // The clock runs per mode entry (chip visibility) and is never persisted.
  const timer = useSessionTimer(visible && sessionTimer, readingClock);
  const sessionElapsed = timer.elapsed;
  const timeText = timer.showClock
    ? timer.now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : sessionElapsed;
  const float = useDraggableFloat({ containerRef, controlId: "navigator-readouts" });

  if (!visible) return null;
  const progressText = showProgress && progress ? `${progress.ordinal + 1} / ${progress.total}` : null;
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
        <Button
          variant="ghost"
          size="sm"
          data-ra-float
          {...float.handleProps}
          onClick={() => {
            if (!float.consumeDragClick() && sessionTimer) timer.toggleClock();
          }}
          aria-label={
            sessionTimer
              ? t(timer.showClock ? "textUnitMode.showSessionTime" : "textUnitMode.showCurrentTime")
              : t("textUnitMode.progress")
          }
          title={
            sessionTimer
              ? t(timer.showClock ? "textUnitMode.showSessionTime" : "textUnitMode.showCurrentTime")
              : undefined
          }
          className={cn(
            "ra-motion-overlay-pop pointer-events-auto h-auto cursor-grab touch-none select-none gap-2 rounded-control border border-border bg-[var(--ra-main-surface-color)] px-2.5 py-1 text-caption font-normal tabular-nums text-fg-muted shadow-[0_4px_16px_-6px_rgba(28,25,23,0.25)]",
            float.dragging && "cursor-grabbing text-fg",
          )}
        >
          {progressText && <span aria-label={`${t("textUnitMode.progress")}: ${progressText}`}>{progressText}</span>}
          {progressText && sessionElapsed && <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border" />}
          {sessionElapsed && (
            <span
              aria-label={`${t(timer.showClock ? "textUnitMode.currentTime" : "textUnitMode.sessionTime")}: ${timeText}`}
            >
              {timeText}
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
