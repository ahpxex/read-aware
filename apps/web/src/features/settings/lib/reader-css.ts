import type { CSSProperties } from "react";
import type { ReaderContentWidth, ReaderSettings } from "./reader-settings";

const FONT_FAMILY_MAP = {
  sans: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif:
    '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, Cambria, "Times New Roman", serif',
} as const;

const FONT_SIZE_MAP = {
  "x-small": "0.875rem",
  small: "0.9375rem",
  medium: "1.0625rem",
  large: "1.1875rem",
  "x-large": "1.3125rem",
} as const;

const LINE_HEIGHT_MAP = {
  compact: "1.55",
  comfortable: "1.85",
  relaxed: "2.15",
} as const;

const PARAGRAPH_SPACING_MAP = {
  tight: "0.6rem",
  normal: "1.25rem",
  loose: "1.9rem",
} as const;

// Responsive text measure. foliate's paginator caps the column to its
// `max-inline-size` (a px value it parses from the attribute) and writes that
// onto the body with inline `!important`, which overrides any width we inject
// via a stylesheet. So we drive the measure through the attribute instead —
// scaling it with the live reader width between a readable floor and a generous
// ceiling so the column widens on large screens. See `computeReaderMaxInlineSize`.
const REM_PX = 16;

const CONTENT_WIDTH_TIERS: Record<
  ReaderContentWidth,
  { minRem: number; viewportFraction: number; maxRem: number }
> = {
  narrow: { minRem: 28, viewportFraction: 0.62, maxRem: 54 },
  medium: { minRem: 32, viewportFraction: 0.8, maxRem: 84 },
  wide: { minRem: 38, viewportFraction: 0.94, maxRem: 120 },
};

/**
 * Text measure (px) for foliate's `max-inline-size` attribute, derived from the
 * chosen width tier and the live reader width so the column is responsive.
 * Capped to the container so it never overflows a small window.
 */
export function computeReaderMaxInlineSize(
  contentWidth: ReaderContentWidth,
  containerWidthPx: number,
): number {
  const tier = CONTENT_WIDTH_TIERS[contentWidth];
  const preferred = tier.viewportFraction * containerWidthPx;
  const clamped = Math.max(
    tier.minRem * REM_PX,
    Math.min(preferred, tier.maxRem * REM_PX),
  );
  return Math.round(Math.min(clamped, containerWidthPx));
}

const MARGIN_MAP = {
  compact: "1rem",
  normal: "1.5rem",
  spacious: "3rem",
} as const;

const THEME_MAP = {
  light: { bg: "#ffffff", text: "#1c1917", selection: "rgba(168, 162, 158, 0.34)" },
  warm: { bg: "#f5f1e8", text: "#292524", selection: "rgba(168, 162, 158, 0.34)" },
  dark: { bg: "#1c1917", text: "#d6d3d1", selection: "rgba(168, 162, 158, 0.28)" },
} as const;

export const READER_THEME_BG = {
  light: "#ffffff",
  warm: "#f5f1e8",
  dark: "#1c1917",
} as const;

export function buildReaderContentCss(settings: ReaderSettings): string {
  const fontFamily = FONT_FAMILY_MAP[settings.fontFamily];
  const fontSize = FONT_SIZE_MAP[settings.fontSize];
  const lineHeight = LINE_HEIGHT_MAP[settings.lineSpacing];
  const paragraphSpacing = PARAGRAPH_SPACING_MAP[settings.paragraphSpacing];
  const horizontalMargin = MARGIN_MAP[settings.margins];
  const theme = THEME_MAP[settings.theme];
  const justified = settings.textAlign === "justify";

  return `
    html {
      background: ${theme.bg} !important;
    }

    body {
      box-sizing: border-box !important;
      padding: 2rem ${horizontalMargin} 4rem !important;
      color: ${theme.text} !important;
      background: ${theme.bg} !important;
      font-family: ${fontFamily} !important;
      font-size: ${fontSize} !important;
      line-height: ${lineHeight} !important;
      text-align: ${justified ? "justify" : "start"} !important;
      ${justified ? "hyphens: auto !important;\n      -webkit-hyphens: auto !important;" : ""}
    }

    body > * {
      max-width: 100% !important;
    }

    ::selection {
      background: ${theme.selection} !important;
      color: ${theme.text} !important;
      -webkit-text-fill-color: ${theme.text};
    }

    ::-moz-selection {
      background: ${theme.selection} !important;
      color: ${theme.text} !important;
    }

    p,
    ul,
    ol,
    blockquote {
      margin: 0 0 ${paragraphSpacing} 0 !important;
    }

    h1 {
      margin: 0 0 1.5rem 0 !important;
      font-size: 2.25rem !important;
      line-height: 1.05 !important;
    }

    h2 {
      margin: 2.75rem 0 1.25rem 0 !important;
      font-size: 1.75rem !important;
      line-height: 1.12 !important;
    }

    h3 {
      margin: 2.25rem 0 1rem 0 !important;
      font-size: 1.375rem !important;
      line-height: 1.18 !important;
    }

    img,
    svg,
    video,
    canvas {
      display: block !important;
      width: auto !important;
      max-width: min(100%, 32rem) !important;
      height: auto !important;
      margin: 1.75rem auto !important;
    }

    figure {
      margin: 2rem auto !important;
      max-width: min(100%, 32rem) !important;
    }

    blockquote {
      padding-left: 1.25rem !important;
      border-left: 1px solid rgba(28, 25, 23, 0.18) !important;
    }
  `;
}

/**
 * Inline style for the in-settings reading preview, mirroring the engine CSS
 * above so the preview reflects the live settings without re-deriving values.
 */
export function getReaderPreviewStyle(settings: ReaderSettings): CSSProperties {
  const theme = THEME_MAP[settings.theme];
  return {
    backgroundColor: theme.bg,
    color: theme.text,
    fontFamily: FONT_FAMILY_MAP[settings.fontFamily],
    fontSize: FONT_SIZE_MAP[settings.fontSize],
    lineHeight: LINE_HEIGHT_MAP[settings.lineSpacing],
    textAlign: settings.textAlign === "justify" ? "justify" : "start",
    hyphens: settings.textAlign === "justify" ? "auto" : "manual",
  };
}
