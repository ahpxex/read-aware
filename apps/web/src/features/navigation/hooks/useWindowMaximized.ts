/**
 * Tracks whether the Tauri window is maximized — drives the caption controls'
 * maximize/restore toggle. Subscribes to the window's resize events (maximize
 * and restore both land there) and re-reads the state. Outside the desktop
 * shell it stays false and subscribes to nothing.
 */
import { useEffect, useState } from "react";
import { isTauri } from "../../../platform/environment";

export function useWindowMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();
      const refresh = async () => {
        try {
          const value = await appWindow.isMaximized();
          if (!disposed) setMaximized(value);
        } catch {
          // Missing permission or a closing window — leave the last state.
        }
      };
      void refresh();
      try {
        const stop = await appWindow.onResized(() => void refresh());
        if (disposed) stop();
        else unlisten = stop;
      } catch {
        // Without the event the toggle icon just won't track external resizes.
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return maximized;
}
