import { useMemo } from "react";
import { encode } from "uqr";
import { cn } from "./lib/cn";

/**
 * Light margin a scanner needs around the symbol to find it, in modules — the
 * QR standard's quiet zone. It is drawn inside the tile, so the code scans the
 * same wherever the tile is placed.
 */
const QUIET_ZONE = 4;
/** A finder pattern — the three corner eyes — is 7 modules square. */
const FINDER = 7;
/** How far a data module stands back from its cell's edge, and how round its corners are. */
const MODULE_INSET = 0.04;
const MODULE_RADIUS = 0.26;

/** A square with rounded corners as path data; counter-clockwise cuts a hole in a clockwise shape. */
function roundedSquare(x: number, y: number, side: number, radius: number, counterClockwise = false): string {
  const straight = side - 2 * radius;
  const arc = (dx: number, dy: number) => `a${radius} ${radius} 0 0 ${counterClockwise ? 0 : 1} ${dx} ${dy}`;
  if (counterClockwise) {
    return `M${x + radius} ${y}${arc(-radius, radius)}v${straight}${arc(radius, radius)}h${straight}${arc(radius, -radius)}v${-straight}${arc(-radius, -radius)}z`;
  }
  return `M${x + radius} ${y}h${straight}${arc(radius, radius)}v${straight}${arc(-radius, radius)}h${-straight}${arc(-radius, -radius)}v${-straight}${arc(radius, -radius)}z`;
}

/**
 * The symbol for `value` as one path, in module units with the origin at the
 * symbol's top-left module. Data modules are small squares with softened
 * corners; each finder pattern is redrawn as a rounded ring around a rounded
 * block, the same restrained corners as the controls around it.
 */
function qrSymbol(value: string): { modules: number; path: string } {
  // Level M: the softened modules give up a little of each cell's ink, and the
  // extra correction pays for that many times over.
  const { size, data } = encode(value, { ecc: "M", border: 0 });
  const finderOrigins: [number, number][] = [
    [0, 0],
    [size - FINDER, 0],
    [0, size - FINDER],
  ];
  const inFinder = (x: number, y: number) =>
    finderOrigins.some(([fx, fy]) => x >= fx && x < fx + FINDER && y >= fy && y < fy + FINDER);

  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y]?.[x] && !inFinder(x, y)) {
        path += roundedSquare(x + MODULE_INSET, y + MODULE_INSET, 1 - 2 * MODULE_INSET, MODULE_RADIUS);
      }
    }
  }
  for (const [x, y] of finderOrigins) {
    path += roundedSquare(x, y, FINDER, 2);
    path += roundedSquare(x + 1, y + 1, FINDER - 2, 1.1, true);
    path += roundedSquare(x + 2, y + 2, FINDER - 4, 0.85);
  }
  return { modules: size, path };
}

type QrCodeProps = {
  /** The text the code carries — usually a link. */
  value: string;
  /** Accessible name: say where scanning leads, not that this is a QR code. */
  label: string;
  /** Edge length in px, quiet zone included. Defaults to 128. */
  size?: number;
  className?: string;
};

/**
 * A QR code drawn in the design system's hand: ink on a light tile, softened
 * modules, rounded finder patterns, nothing in the middle.
 *
 * The tile stays light and the modules dark in every theme. Scanners expect
 * dark-on-light, so under the dark theme the tile takes the ink colour and the
 * modules the ground's, rather than the code inverting with the page.
 *
 * Keep it at 112px or more on screen: a link-sized code has about fifty modules
 * a side with its quiet zone, and a phone camera needs two pixels for each.
 */
export function QrCode({ value, label, size = 128, className }: QrCodeProps) {
  const { modules, path } = useMemo(() => qrSymbol(value), [value]);
  const extent = modules + 2 * QUIET_ZONE;

  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${extent} ${extent}`}
      className={cn(
        "shrink-0 rounded-control bg-surface text-fg ring-1 ring-border dark:bg-fg dark:text-inverse-fg dark:ring-0",
        className,
      )}
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
