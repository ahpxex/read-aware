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
 *
 * This half decides whether the chrome exists and what each button does; the
 * buttons are `WindowCaptionControlsView`.
 */
import { useEffect } from "react";
import { desktopChromeKind, isMacOS, isWindows } from "../../../platform/environment";
import { setTrafficLightsVisible } from "../../../platform/traffic-lights";
import { useWindowMaximized } from "../hooks/useWindowMaximized";
import { WindowCaptionControlsView } from "./WindowCaptionControlsView";

async function currentWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export function WindowCaptionControls() {
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
    <WindowCaptionControlsView
      maximized={maximized}
      onMinimize={() => void currentWindow().then((w) => w.minimize())}
      onToggleMaximize={() => void currentWindow().then((w) => w.toggleMaximize())}
      onClose={() => void currentWindow().then((w) => w.close())}
      onMaximizeHover={showSnapOverlay}
    />
  );
}
