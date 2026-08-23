/**
 * Edge/corner resize zones for the frameless Linux shell. An undecorated GTK
 * window loses its native resize borders, so thin strips along the window
 * edges hand the drag to the window manager via startResizeDragging. Windows
 * keeps its native resize frame even undecorated (the window shadow carries
 * it), and macOS never goes frameless here — both render nothing. Hidden while
 * maximized, when there is nothing to resize.
 *
 * This half owns those platform decisions; the zones are
 * `WindowResizeEdgesView`.
 */
import { isLinux, isTauri } from "../../../platform/environment";
import { useWindowMaximized } from "../hooks/useWindowMaximized";
import {
  WindowResizeEdgesView,
  type ResizeDirection,
} from "./WindowResizeEdgesView";

export function WindowResizeEdges() {
  const maximized = useWindowMaximized();
  if (!isTauri() || !isLinux() || maximized) return null;

  const beginResize = (direction: ResizeDirection) => {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow()
        .startResizeDragging(direction)
        .catch(() => {}),
    );
  };

  return <WindowResizeEdgesView onBeginResize={beginResize} />;
}
