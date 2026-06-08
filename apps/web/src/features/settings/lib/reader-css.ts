import type { ReaderSettings } from "./reader-settings";

const FONT_SIZE_MAP = {
  small: "0.9375rem",
  medium: "1.0625rem",
  large: "1.1875rem",
} as const;

const LINE_HEIGHT_MAP = {
  compact: "1.65",
  comfortable: "1.9",
  relaxed: "2.15",
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
  const fontSize = FONT_SIZE_MAP[settings.fontSize];
  const lineHeight = LINE_HEIGHT_MAP[settings.lineSpacing];
  const theme = THEME_MAP[settings.theme];

  return `
    html {
      background: ${theme.bg} !important;
    }

    body {
      box-sizing: border-box !important;
      width: min(100%, 56rem) !important;
      max-width: 56rem !important;
      margin: 0 auto !important;
      padding: 2rem 1.5rem 4rem !important;
      color: ${theme.text} !important;
      background: ${theme.bg} !important;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      font-size: ${fontSize} !important;
      line-height: ${lineHeight} !important;
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
      margin: 0 0 1.25rem 0 !important;
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
