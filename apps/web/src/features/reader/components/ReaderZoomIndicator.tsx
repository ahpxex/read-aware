import { ArrowCounterClockwise, LockSimple, LockSimpleOpen } from "@phosphor-icons/react";
import { IconButton } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { ZoomFeedback } from "../lib/zoom-feedback";
import { useZoomIndicator } from "../hooks/useZoomIndicator";

type Props = {
  feedback: ZoomFeedback;
  /** The reader controls are showing; a zoomed or locked view then stays up with them. */
  controlsVisible: boolean;
  locked: boolean;
  onToggleLock: () => void;
  onReset: () => void;
};

/**
 * The zoom of a fixed-layout page: shown briefly while it changes, and —
 * while the reader controls are up and the page is zoomed or its view
 * locked — kept up with a lock that holds the view still across the reading
 * and a one-click way back to the fit. Same surface as the progress readout; only its buttons take
 * pointer input, so pinches pass through to the page.
 */
export function ReaderZoomIndicator({ feedback, controlsVisible, locked, onToggleLock, onReset }: Props) {
  const { t } = useTranslation("reader");
  const indicator = useZoomIndicator(feedback, controlsVisible, locked);
  const showLock = indicator?.resettable || locked;
  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--ra-safe-bottom)+5rem)] z-20 flex justify-center"
    >
      {indicator?.visible && (
        // Fades in when it comes up; while it stays up (a live pinch) only
        // the number changes.
        <div className="ra-motion-fade-in flex items-center gap-0.5 rounded-surface bg-[var(--ra-main-surface-color)] py-1 pr-1 pl-3 shadow-[0_6px_20px_-6px_rgba(28,25,23,0.35)]">
          <span className="font-sans text-sm tabular-nums text-fg">
            <span className="sr-only">{t("pageZoom")} </span>
            {indicator.percent}%
          </span>
          {showLock && (
            <IconButton
              label={t(locked ? "pageZoomUnlock" : "pageZoomLock")}
              aria-pressed={locked}
              size="sm"
              onClick={onToggleLock}
              className="pointer-events-auto"
              icon={
                locked ? (
                  <LockSimple size={14} weight="fill" aria-hidden="true" />
                ) : (
                  <LockSimpleOpen size={14} aria-hidden="true" />
                )
              }
            />
          )}
          {indicator.resettable ? (
            <IconButton
              label={t("pageZoomReset")}
              size="sm"
              onClick={onReset}
              className="pointer-events-auto"
              icon={<ArrowCounterClockwise size={14} aria-hidden="true" />}
            />
          ) : (
            !showLock && <span aria-hidden="true" className="w-2" />
          )}
        </div>
      )}
    </div>
  );
}
