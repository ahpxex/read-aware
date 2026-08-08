/**
 * How a fixed-layout page (PDF, comic) should answer the reader's palette.
 *
 * A reflowable book takes the palette as CSS. A fixed-layout page is a picture,
 * so the palette has to be applied while the page is being drawn, and there are
 * only two honest ways to do it:
 *
 * - **Tint the paper.** Fill the canvas with the palette background before the
 *   page is painted on top. Nothing else changes — every ink, photograph and
 *   figure survives exactly as authored. This works whenever the paper is
 *   lighter than the ink, which is to say for every light palette.
 * - **Remap the tonal range.** Black ink cannot be painted onto dark paper, so
 *   a dark palette has to run the page through a duotone filter that flattens
 *   it to luminance and stretches that range between the palette's text and
 *   background colors. The page keeps every detail and loses its color; there
 *   is no version of this that does not.
 *
 * So the decision is made by comparing the palette against itself — dark paper
 * is the whole signal — rather than by naming themes, which would miss every
 * plugin-contributed palette.
 */

import type { ReaderPalette } from "../../settings/lib/reader-theme";
import type { FixedLayoutColor } from "../../settings/lib/reader-settings";

/**
 * What the engine renders with: `background` alone tints the paper, adding a
 * `foreground` asks for the tonal remap. Null renders the page as authored.
 */
export type FixedLayoutPageColors = {
  background: string;
  foreground?: string;
} | null;

/** Relative luminance (WCAG) of a `#rgb` / `#rrggbb` color, or null. */
function luminance(color: string): number | null {
  const hex = color.trim().replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex.split("").map((c) => c + c).join("")
      : hex.length === 6
        ? hex
        : null;
  if (full == null || !/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const channel = (offset: number) => {
    const value = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export function fixedLayoutPageColors(
  palette: ReaderPalette,
  setting: FixedLayoutColor,
): FixedLayoutPageColors {
  if (setting === "original") return null;

  const paper = luminance(palette.bg);
  const ink = luminance(palette.text);
  // A palette we cannot measure (a plugin using `rgb()`, `oklch()`, a gradient)
  // gets the lossless treatment: tinting a page that turns out to be dark is a
  // cosmetic miss, while remapping one that turns out to be light would throw
  // away color for nothing.
  if (paper == null || ink == null) return { background: palette.bg };

  return paper < ink
    ? { background: palette.bg, foreground: palette.text }
    : { background: palette.bg };
}
