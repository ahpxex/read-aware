/**
 * The self-drawn caption controls themselves — minimize, maximize/restore,
 * close — as pure presentation.
 *
 * Split from `WindowCaptionControls` so the platform test, the traffic-light
 * dance and the Tauri window calls stay in the container. In the app this
 * chrome only exists on the frameless Windows and Linux shells, which is
 * exactly why the buttons are worth being able to render anywhere.
 */
import { CopySimple, Minus, Square, X } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";

const buttonClass =
  "flex h-full w-11 items-center justify-center text-fg-muted transition-colors hover:bg-fg/8 hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-fg";

type WindowCaptionControlsViewProps = {
  /** Drives the middle button's glyph and label. */
  maximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  /**
   * Hovering the maximize button opens Windows 11's Snap Layouts. A self-drawn
   * button has to ask for that explicitly; elsewhere it is a no-op.
   */
  onMaximizeHover?: () => void;
};

export function WindowCaptionControlsView({
  maximized,
  onMinimize,
  onToggleMaximize,
  onClose,
  onMaximizeHover,
}: WindowCaptionControlsViewProps) {
  const { t } = useTranslation("nav");

  return (
    <div className="pointer-events-auto absolute inset-y-0 right-0 z-20 flex items-stretch">
      <button
        type="button"
        aria-label={t("window.minimize")}
        className={buttonClass}
        onClick={onMinimize}
      >
        <Minus size={14} weight="regular" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={maximized ? t("window.restore") : t("window.maximize")}
        className={buttonClass}
        onMouseEnter={onMaximizeHover}
        onClick={onToggleMaximize}
      >
        {maximized ? (
          <CopySimple size={14} weight="regular" aria-hidden="true" />
        ) : (
          <Square size={13} weight="regular" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        aria-label={t("window.close")}
        className={cn(buttonClass, "hover:bg-red-600 hover:text-white")}
        onClick={onClose}
      >
        <X size={15} weight="regular" aria-hidden="true" />
      </button>
    </div>
  );
}
