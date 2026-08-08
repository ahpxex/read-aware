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

const linearize = (value: number) =>
  value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

/** `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` to 0..1 channels, or null. */
function hexChannels(color: string): [number, number, number] | null {
  const hex = color.trim().replace(/^#/, "");
  const expand = (h: string) => h.split("").map((c) => c + c).join("");
  const full =
    hex.length === 3 || hex.length === 4
      ? expand(hex.slice(0, 3))
      : hex.length === 6 || hex.length === 8
        ? hex.slice(0, 6)
        : null;
  if (full == null || !/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

const hueToChannel = (p: number, q: number, t: number) => {
  const h = ((t % 1) + 1) % 1;
  if (h < 1 / 6) return p + (q - p) * 6 * h;
  if (h < 1 / 2) return q;
  if (h < 2 / 3) return p + (q - p) * (2 / 3 - h) * 6;
  return p;
};

/**
 * `rgb()` / `rgba()` / `hsl()` / `hsla()` to 0..1 channels, or null.
 *
 * These are exactly the function forms a plugin palette may declare (see
 * `isPluginThemeColor`, whose body admits only digits, separators and `%` — so
 * no units, keywords or nested functions can reach here). Parsing them here
 * rather than through a canvas keeps this measurable without a DOM, which is
 * what lets the dark-palette decision be tested at all.
 */
function funcChannels(color: string): [number, number, number] | null {
  const match = color.trim().match(/^(rgba?|hsla?)\(([^)]*)\)$/i);
  if (!match) return null;
  // Alpha does not affect which side of the palette a color sits on.
  const parts = match[2].split("/")[0].split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const values = parts.slice(0, 3).map((part) => ({
    value: Number.parseFloat(part),
    percent: part.trim().endsWith("%"),
  }));
  if (values.some((v) => !Number.isFinite(v.value))) return null;

  if (match[1].toLowerCase().startsWith("rgb")) {
    return values.map((v) => (v.percent ? v.value / 100 : v.value / 255)) as [
      number,
      number,
      number,
    ];
  }

  const hue = values[0].value / 360;
  const saturation = values[1].value / 100;
  const lightness = values[2].value / 100;
  if (saturation === 0) return [lightness, lightness, lightness];
  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return [
    hueToChannel(p, q, hue + 1 / 3),
    hueToChannel(p, q, hue),
    hueToChannel(p, q, hue - 1 / 3),
  ];
}

/** Relative luminance (WCAG) of a palette color, or null if unreadable. */
function luminance(color: string): number | null {
  const channels = hexChannels(color) ?? funcChannels(color);
  if (!channels) return null;
  const [r, g, b] = channels
    .map((c) => Math.min(1, Math.max(0, c)))
    .map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function fixedLayoutPageColors(
  palette: ReaderPalette,
  setting: FixedLayoutColor,
): FixedLayoutPageColors {
  if (setting === "original") return null;

  const paper = luminance(palette.bg);
  const ink = luminance(palette.text);
  // A palette we cannot measure leaves the page alone. The tempting fallback —
  // tint it and skip the remap — is the one genuinely unusable outcome: if that
  // palette turns out to be dark, the page gets dark paper with the author's
  // black ink still on it and the text disappears. An untinted page in a dark
  // app is merely a cosmetic miss, so that is the way to be wrong.
  if (paper == null || ink == null) return null;

  return paper < ink
    ? { background: palette.bg, foreground: palette.text }
    : { background: palette.bg };
}
