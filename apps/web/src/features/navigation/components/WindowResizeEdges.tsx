/**
 * Edge/corner resize zones for the frameless Linux shell. An undecorated GTK
 * window loses its native resize borders, so thin strips along the window
 * edges hand the drag to the window manager via startResizeDragging. Windows
 * keeps its native resize frame even undecorated (the window shadow carries
 * it), and macOS never goes frameless here — both render nothing. Hidden while
 * maximized, when there is nothing to resize.
 */
import { isLinux, isTauri } from "../../../platform/environment";
import { useWindowMaximized } from "../hooks/useWindowMaximized";

type Direction =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

const EDGE = "5px";
const CORNER = "10px";

const ZONES: Array<{ direction: Direction; style: React.CSSProperties; cursor: string }> = [
  { direction: "North", style: { top: 0, left: CORNER, right: CORNER, height: EDGE }, cursor: "n-resize" },
  { direction: "South", style: { bottom: 0, left: CORNER, right: CORNER, height: EDGE }, cursor: "s-resize" },
  { direction: "West", style: { left: 0, top: CORNER, bottom: CORNER, width: EDGE }, cursor: "w-resize" },
  { direction: "East", style: { right: 0, top: CORNER, bottom: CORNER, width: EDGE }, cursor: "e-resize" },
  { direction: "NorthWest", style: { top: 0, left: 0, width: CORNER, height: CORNER }, cursor: "nw-resize" },
  { direction: "NorthEast", style: { top: 0, right: 0, width: CORNER, height: CORNER }, cursor: "ne-resize" },
  { direction: "SouthWest", style: { bottom: 0, left: 0, width: CORNER, height: CORNER }, cursor: "sw-resize" },
  { direction: "SouthEast", style: { bottom: 0, right: 0, width: CORNER, height: CORNER }, cursor: "se-resize" },
];

export function WindowResizeEdges() {
  const maximized = useWindowMaximized();
  if (!isTauri() || !isLinux() || maximized) return null;

  const beginResize = (direction: Direction) => {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow()
        .startResizeDragging(direction)
        .catch(() => {}),
    );
  };

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[100]">
      {ZONES.map(({ direction, style, cursor }) => (
        <div
          key={direction}
          className="pointer-events-auto absolute"
          style={{ ...style, cursor }}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            beginResize(direction);
          }}
        />
      ))}
    </div>
  );
}
