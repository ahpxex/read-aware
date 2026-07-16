/**
 * Self-drawn window caption controls — minimize / maximize-restore / close —
 * for the frameless Windows and Linux shells, sitting flush against the
 * header's top-right corner (mirroring the macOS traffic lights on the left).
 * Renders nothing when the platform draws its own chrome (macOS, browser,
 * mobile). Layout reserves their width via --ra-window-controls-inset.
 *
 * On macOS a dev preview is available: `localStorage.setItem("ra-debug-os",
 * "windows")` + reload forces this chrome (and hides the real traffic lights
 * while mounted) so the layout can be exercised without a Windows machine.
 */
import { CopySimple, Minus, Square, X } from "@phosphor-icons/react";
import { useEffect } from "react";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { desktopChromeKind, isMacOS, isWindows } from "../../../platform/environment";
import { setTrafficLightsVisible } from "../../../platform/traffic-lights";
import { useWindowMaximized } from "../hooks/useWindowMaximized";

async function currentWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

const buttonClass =
  "flex h-full w-11 items-center justify-center text-fg-muted transition-colors hover:bg-fg/8 hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-fg";

export function WindowCaptionControls() {
  const { t } = useTranslation("nav");
  const custom = desktopChromeKind() === "custom";
  const maximized = useWindowMaximized();

  // Dev preview on a real Mac: the native traffic lights would double up with
  // these controls — hide them for the preview's lifetime.
  useEffect(() => {
    if (!custom || !isMacOS()) return;
    void setTrafficLightsVisible(false);
    return () => {
      void setTrafficLightsVisible(true);
    };
  }, [custom]);

  if (!custom) return null;

  // Windows 11 Snap Layouts open from hovering the native maximize button;
  // decorum's command replays that for a self-drawn one. Elsewhere it no-ops.
  const showSnapOverlay = () => {
    if (!isWindows()) return;
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("plugin:decorum|show_snap_overlay").catch(() => {}),
    );
  };

  return (
    <div className="pointer-events-auto absolute inset-y-0 right-0 z-20 flex items-stretch">
      <button
        type="button"
        aria-label={t("window.minimize")}
        className={buttonClass}
        onClick={() => void currentWindow().then((w) => w.minimize())}
      >
        <Minus size={14} weight="regular" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={maximized ? t("window.restore") : t("window.maximize")}
        className={buttonClass}
        onMouseEnter={showSnapOverlay}
        onClick={() => void currentWindow().then((w) => w.toggleMaximize())}
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
        onClick={() => void currentWindow().then((w) => w.close())}
      >
        <X size={15} weight="regular" aria-hidden="true" />
      </button>
    </div>
  );
}
