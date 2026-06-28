import type { CSSProperties } from "react";
import {
  curatedFontId,
  systemFontFamily,
  type ReaderContentWidth,
  type ReaderFontFamily,
  type ReaderSettings,
} from "./reader-settings";
import { curatedFallback, getCuratedFont } from "./curated-fonts";

// Trailing fallbacks after a user-picked system family, so a missing glyph (or a
// font that was later uninstalled) lands on a readable default.
const SYSTEM_FONT_FALLBACK = "ui-sans-serif, system-ui, sans-serif";
const DEFAULT_FONT_STACK = `ui-sans-serif, system-ui, ${SYSTEM_FONT_FALLBACK}`;

/** Strip characters that could break out of the `font-family` declaration. */
function sanitizeFamily(family: string): string {
  return family.replace(/["\\;{}<>]/g, "").trim();
}

/**
 * Resolve a stored font selection to a CSS `font-family` stack. Curated and
 * system families are quoted and sanitized — the value is interpolated into a
 * stylesheet we inject into the foliate iframe, so it must not be able to break
 * out of the declaration. (Whether the curated webfont is actually loaded is the
 * loader's concern; this only names it.)
 */
export function resolveReaderFontStack(fontFamily: ReaderFontFamily): string {
  const curatedId = curatedFontId(fontFamily);
  if (curatedId) {
    const font = getCuratedFont(curatedId);
    if (font) {
      const safe = sanitizeFamily(font.family);
      if (safe) return `"${safe}", ${curatedFallback(font.kind)}`;
    }
    return DEFAULT_FONT_STACK;
  }
  const family = systemFontFamily(fontFamily);
  if (family) {
    const safe = sanitizeFamily(family);
    if (safe) return `"${safe}", ${SYSTEM_FONT_FALLBACK}`;
  }
  return DEFAULT_FONT_STACK;
}

const FONT_SIZE_MAP = {
  "xx-small": "0.8125rem",
  "x-small": "0.875rem",
  small: "0.9375rem",
  medium: "1.0625rem",
  large: "1.1875rem",
  "x-large": "1.3125rem",
  "xx-large": "1.5rem",
  "xxx-large": "1.75rem",
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
  light: {
    bg: "#ffffff",
    text: "#1c1917",
    selection: "rgba(168, 162, 158, 0.34)",
    rule: "rgba(28, 25, 23, 0.14)",
    faint: "rgba(28, 25, 23, 0.05)",
    muted: "rgba(28, 25, 23, 0.55)",
  },
  warm: {
    bg: "#f5f1e8",
    text: "#292524",
    selection: "rgba(168, 162, 158, 0.34)",
    rule: "rgba(41, 37, 36, 0.16)",
    faint: "rgba(41, 37, 36, 0.05)",
    muted: "rgba(41, 37, 36, 0.55)",
  },
  dark: {
    bg: "#1c1917",
    text: "#d6d3d1",
    selection: "rgba(168, 162, 158, 0.28)",
    rule: "rgba(214, 211, 209, 0.2)",
    faint: "rgba(214, 211, 209, 0.07)",
    muted: "rgba(214, 211, 209, 0.55)",
  },
} as const;

export const READER_THEME_BG = {
  light: "#ffffff",
  warm: "#f5f1e8",
  dark: "#1c1917",
} as const;

/**
 * Build the stylesheet injected into the foliate section iframe.
 *
 * `fontFaceCss` carries the `@font-face` rules for the active curated font (with
 * its on-demand blob URLs) so the book renders in that webfont; it's empty for
 * system/preset fonts, which need no @font-face. See `curated-font-loader`.
 */
export function buildReaderContentCss(settings: ReaderSettings, fontFaceCss = ""): string {
  const fontFamily = resolveReaderFontStack(settings.fontFamily);
  const fontSize = FONT_SIZE_MAP[settings.fontSize];
  const lineHeight = LINE_HEIGHT_MAP[settings.lineSpacing];
  const paragraphSpacing = PARAGRAPH_SPACING_MAP[settings.paragraphSpacing];
  const horizontalMargin = MARGIN_MAP[settings.margins];
  const theme = THEME_MAP[settings.theme];
  const justified = settings.textAlign === "justify";

  return `
    ${fontFaceCss}
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

    h4 {
      margin: 1.85rem 0 0.75rem 0 !important;
      font-size: 1.15rem !important;
      line-height: 1.25 !important;
    }

    h5,
    h6 {
      margin: 1.5rem 0 0.5rem 0 !important;
      font-size: 1rem !important;
      line-height: 1.3 !important;
    }

    /* Links read as body text with a quiet underline, not a bright accent. */
    a {
      color: inherit !important;
      text-decoration: underline !important;
      text-decoration-color: ${theme.muted} !important;
      text-decoration-thickness: 0.06em !important;
      text-underline-offset: 0.18em !important;
    }

    a:hover {
      text-decoration-color: ${theme.text} !important;
    }

    ul,
    ol {
      padding-left: 1.6em !important;
    }

    ul {
      list-style: disc !important;
    }

    ol {
      list-style: decimal !important;
    }

    li {
      margin: 0 0 0.4em 0 !important;
      padding-left: 0.25em !important;
    }

    li::marker {
      color: ${theme.muted} !important;
    }

    ul ul,
    ul ol,
    ol ul,
    ol ol {
      margin: 0.4em 0 0 0 !important;
    }

    code,
    kbd,
    samp {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace !important;
      font-size: 0.875em !important;
    }

    :not(pre) > code {
      padding: 0.1em 0.35em !important;
      background: ${theme.faint} !important;
      border-radius: 0.25rem !important;
    }

    pre {
      margin: 0 0 ${paragraphSpacing} 0 !important;
      padding: 1rem 1.15rem !important;
      background: ${theme.faint} !important;
      border-radius: 0.4rem !important;
      line-height: 1.5 !important;
      overflow-x: auto !important;
    }

    pre code {
      padding: 0 !important;
      background: none !important;
      font-size: inherit !important;
    }

    hr {
      margin: 2.5rem auto !important;
      border: none !important;
      border-top: 1px solid ${theme.rule} !important;
    }

    table {
      width: 100% !important;
      margin: 0 0 ${paragraphSpacing} 0 !important;
      border-collapse: collapse !important;
      font-size: 0.95em !important;
    }

    th,
    td {
      padding: 0.5em 0.7em !important;
      border: 1px solid ${theme.rule} !important;
      text-align: start !important;
      vertical-align: top !important;
    }

    th {
      font-weight: 600 !important;
    }

    figcaption {
      margin-top: 0.6rem !important;
      color: ${theme.muted} !important;
      font-size: 0.85em !important;
      text-align: center !important;
    }

    blockquote {
      padding-left: 1.25rem !important;
      border-left: 2px solid ${theme.rule} !important;
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
    fontFamily: resolveReaderFontStack(settings.fontFamily),
    fontSize: FONT_SIZE_MAP[settings.fontSize],
    lineHeight: LINE_HEIGHT_MAP[settings.lineSpacing],
    textAlign: settings.textAlign === "justify" ? "justify" : "start",
    hyphens: settings.textAlign === "justify" ? "auto" : "manual",
  };
}
