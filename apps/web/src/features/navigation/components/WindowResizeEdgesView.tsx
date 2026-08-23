/**
 * The resize zones themselves — thin strips along the window's edges and
 * corners, each carrying the direction it drags.
 *
 * Split from `WindowResizeEdges` so the platform test and the window-manager
 * call stay in the container. In the app these only exist on the frameless
 * Linux shell, and they are deliberately invisible; the split is what lets
 * their geometry be looked at at all.
 */
export type ResizeDirection =
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

export const RESIZE_ZONES: Array<{
  direction: ResizeDirection;
  style: React.CSSProperties;
  cursor: string;
}> = [
  { direction: "North", style: { top: 0, left: CORNER, right: CORNER, height: EDGE }, cursor: "n-resize" },
  { direction: "South", style: { bottom: 0, left: CORNER, right: CORNER, height: EDGE }, cursor: "s-resize" },
  { direction: "West", style: { left: 0, top: CORNER, bottom: CORNER, width: EDGE }, cursor: "w-resize" },
  { direction: "East", style: { right: 0, top: CORNER, bottom: CORNER, width: EDGE }, cursor: "e-resize" },
  { direction: "NorthWest", style: { top: 0, left: 0, width: CORNER, height: CORNER }, cursor: "nw-resize" },
  { direction: "NorthEast", style: { top: 0, right: 0, width: CORNER, height: CORNER }, cursor: "ne-resize" },
  { direction: "SouthWest", style: { bottom: 0, left: 0, width: CORNER, height: CORNER }, cursor: "sw-resize" },
  { direction: "SouthEast", style: { bottom: 0, right: 0, width: CORNER, height: CORNER }, cursor: "se-resize" },
];

type WindowResizeEdgesViewProps = {
  onBeginResize: (direction: ResizeDirection) => void;
  /** Positioning context. `fixed` in the app; `absolute` to inspect in a box. */
  position?: "fixed" | "absolute";
  /** Debug aid: tint the zones so their geometry is visible. */
  showZones?: boolean;
};

export function WindowResizeEdgesView({
  onBeginResize,
  position = "fixed",
  showZones = false,
}: WindowResizeEdgesViewProps) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none inset-0 z-[100] ${position}`}
    >
      {RESIZE_ZONES.map(({ direction, style, cursor }) => (
        <div
          key={direction}
          className={`pointer-events-auto absolute ${showZones ? "bg-fg/25" : ""}`}
          style={{ ...style, cursor }}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            onBeginResize(direction);
          }}
        />
      ))}
    </div>
  );
}
