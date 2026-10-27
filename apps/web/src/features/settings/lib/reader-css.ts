import type { CSSProperties } from "react";
import {
  curatedFontId,
  customTypographyFromPresets,
  READER_FONT_SIZE_REM,
  READER_FONT_WEIGHTS,
  READER_LINE_HEIGHT,
  READER_PARAGRAPH_SPACING_REM,
  resolveReaderFontWeight,
  isPluginFont,
  isUserFont,
  systemFontFamily,
  userFontId,
  type ReaderFontFamily,
  type ReaderFontWeight,
  type ReaderPageMargins,
  type ReaderSettings,
  type ReaderTextAlign,
  type ReadingMode,
} from "./reader-settings";
import { curatedFallback, getCuratedFont, type CuratedFontKind } from "./curated-fonts";
import type { ReaderPalette } from "./reader-theme";

// Trailing fallbacks after a user-picked system family, so a missing glyph (or a
// font that was later uninstalled) lands on a readable default.
const SYSTEM_FONT_FALLBACK = "ui-sans-serif, system-ui, sans-serif";
const DEFAULT_FONT_STACK = `ui-sans-serif, system-ui, ${SYSTEM_FONT_FALLBACK}`;

/** Strip characters that could break out of the `font-family` declaration. */
function sanitizeFamily(family: string): string {
  return family.replace(/["\\;{}<>]/g, "").trim();
}

/**
 * What a `plugin:` font selection resolves through: the registered
 * contribution's family and fallback kind. Callers look it up in the plugin
 * font registry; null/undefined (plugin missing) falls back to the default
 * stack.
 */
export type PluginFontStackSource = {
  family: string;
  kind?: CuratedFontKind;
};

/**
 * Resolve a stored font selection to a CSS `font-family` stack. Every family
 * is quoted and sanitized — the value is interpolated into a stylesheet we
 * inject into the foliate iframe, so it must not be able to break out of the
 * declaration. (Whether the webfont is actually loaded is the loader's
 * concern; this only names it.)
 */
export function resolveReaderFontStack(
  fontFamily: ReaderFontFamily,
  pluginFont?: PluginFontStackSource | null,
): string {
  const curatedId = curatedFontId(fontFamily);
  if (curatedId) {
    const font = getCuratedFont(curatedId);
    if (font) {
      const safe = sanitizeFamily(font.family);
      if (safe) return `"${safe}", ${curatedFallback(font.kind)}`;
    }
    return DEFAULT_FONT_STACK;
  }
  if (isPluginFont(fontFamily)) {
    const safe = pluginFont ? sanitizeFamily(pluginFont.family) : "";
    if (safe) return `"${safe}", ${curatedFallback(pluginFont?.kind ?? "serif")}`;
    return DEFAULT_FONT_STACK;
  }
  // Imported fonts resolve through a generated family name (`ra-user-<sha>`)
  // so an imported "Inter" never shadows the curated/system Inter. The
  // @font-face behind the name comes from `userFontFaceCss` — a font whose
  // registry row or bytes are absent simply falls through to the fallback.
  const importedId = userFontId(fontFamily);
  if (importedId && isUserFont(fontFamily)) {
    return `"ra-user-${importedId}", ${SYSTEM_FONT_FALLBACK}`;
  }
  const family = systemFontFamily(fontFamily);
  if (family) {
    const safe = sanitizeFamily(family);
    if (safe) return `"${safe}", ${SYSTEM_FONT_FALLBACK}`;
  }
  return DEFAULT_FONT_STACK;
}

/** Download the actual body face plus regular and the publisher's bold face. */
export function readerFontWeightsNeeded(fontWeight: ReaderFontWeight, fontFamily?: ReaderFontFamily): number[] {
  const weight = READER_FONT_WEIGHTS[resolveReaderFontWeight(fontWeight, fontFamily)];
  return [...new Set([weight, 400, 700])].sort((a, b) => a - b);
}

const FONT_SIZE_MAP = READER_FONT_SIZE_REM;
const LINE_HEIGHT_MAP = READER_LINE_HEIGHT;
const PARAGRAPH_SPACING_MAP = READER_PARAGRAPH_SPACING_REM;

// Responsive text measure. foliate's paginator caps the column to its
// `max-inline-size` (a px value it parses from the attribute) and writes that
// onto the body with inline `!important`, which overrides any width we inject
// via a stylesheet. So we drive the measure through the attribute instead —
// scaling it with the live reader width between a readable floor and a generous
// ceiling so the column widens on large screens. See `computeReaderMaxInlineSize`.
const REM_PX = 16;

// Fixed reading measure: a readable floor, a viewport-scaled preferred width,
// and a generous ceiling so the column widens on large screens without ever
// running edge to edge.
const MEASURE_MIN_REM = 32;
const MEASURE_VIEWPORT_FRACTION = 0.8;
const MEASURE_MAX_REM = 84;

/**
 * Page-margin presets: each drives the three knobs that together read as the
 * page margin — the text measure (how much of the container the column fills),
 * foliate's `gap` (edge/column padding, a percentage of the container), and
 * the body's own horizontal padding.
 *
 * "narrow" is the mobile-typical look (measure fills the container; the gap
 * and padding alone are the margin); "wide" is the roomier desktop editorial
 * measure. The device-appropriate default lives in `reader-settings.ts`.
 */
const READER_MARGIN_PRESETS = {
  narrow: { measureFraction: "fill", gap: "3%", horizontalPadding: "0.75rem" },
  medium: { measureFraction: 0.9, gap: "5%", horizontalPadding: "1rem" },
  wide: { measureFraction: MEASURE_VIEWPORT_FRACTION, gap: "7%", horizontalPadding: "1.5rem" },
} as const satisfies Record<
  ReaderPageMargins,
  { measureFraction: number | "fill"; gap: string; horizontalPadding: string }
>;

// Spreads share the viewport between two pages. Give each column more room
// without changing the user's chosen margin preset or the single-page measure.
const READER_SPREAD_MARGIN_PRESETS = {
  narrow: { gap: "1%", horizontalPadding: "0.25rem" },
  medium: { gap: "2%", horizontalPadding: "0.5rem" },
  wide: { gap: "3%", horizontalPadding: "0.75rem" },
} as const satisfies Record<ReaderPageMargins, { gap: string; horizontalPadding: string }>;

/** The settings fields typography resolution reads — preset tiers or the
 * custom numbers behind `typographyMode`. */
export type ReaderTypographySettings = Pick<
  ReaderSettings,
  "fontSize" | "lineSpacing" | "paragraphSpacing" | "pageMargins" | "textIndent" | "typographyMode" | "customTypography"
>;

export type ResolvedReaderTypography = {
  /** CSS font-size for the body rule (`rem` preset, `px` custom). */
  fontSize: string;
  fontSizeRem: number;
  lineHeight: string;
  /** CSS margin-bottom for paragraphs (`rem` preset, `em` custom). */
  paragraphSpacing: string;
  /** CSS text-indent, or null to leave the publisher's alone. */
  textIndent: string | null;
  margins: {
    measureFraction: number | "fill";
    gap: string;
    horizontalPadding: string;
    spreadGap: string;
    spreadHorizontalPadding: string;
    /**
     * The requested outer side margin as a reader-width fraction — custom
     * mode only; presets carry `null` and keep their tuned gap strings.
     * Measured against the real paginator: the visible outer margin lands at
     * `g` of the width in paginated flow and `g / (1 - g)` in scrolled flow
     * (the gap attribute becomes half-gap columns at the outer edges plus a
     * scaled column gap inside the frame), plus the body padding below — so
     * `readerLayoutSpacing` writes `g = p` for paginated and `g = p/(1 + p)`
     * for scroll. The 0.75rem/0.25rem padding is a small floor on top of `p`
     * so `0%` never touches the window chrome.
     */
    outerFraction: number | null;
  };
};

/**
 * The single place preset tiers and custom numbers become CSS values. Every
 * consumer — the injected stylesheet, the paginator layout attributes, the
 * settings preview and content typography — resolves through here so the two
 * modes can never drift apart.
 */
export function resolveReaderTypography(settings: ReaderTypographySettings): ResolvedReaderTypography {
  if (settings.typographyMode === "custom") {
    const custom = settings.customTypography ?? customTypographyFromPresets(settings);
    return {
      fontSize: `${custom.fontSizePx}px`,
      fontSizeRem: custom.fontSizePx / 16,
      lineHeight: String(custom.lineHeight),
      paragraphSpacing: `${custom.paragraphSpacingEm}em`,
      textIndent: custom.textIndentEm === null ? null : `${custom.textIndentEm}em`,
      margins: {
        measureFraction: "fill",
        gap: `${custom.pageMarginPercent}%`,
        spreadGap: `${custom.pageMarginPercent}%`,
        horizontalPadding: "0.75rem",
        spreadHorizontalPadding: "0.25rem",
        outerFraction: custom.pageMarginPercent / 100,
      },
    };
  }
  const preset = READER_MARGIN_PRESETS[settings.pageMargins];
  const spread = READER_SPREAD_MARGIN_PRESETS[settings.pageMargins];
  return {
    fontSize: FONT_SIZE_MAP[settings.fontSize],
    fontSizeRem: Number.parseFloat(FONT_SIZE_MAP[settings.fontSize]),
    lineHeight: LINE_HEIGHT_MAP[settings.lineSpacing],
    paragraphSpacing: PARAGRAPH_SPACING_MAP[settings.paragraphSpacing],
    textIndent: { book: null, none: "0", two: "2em" }[settings.textIndent],
    margins: {
      measureFraction: preset.measureFraction,
      gap: preset.gap,
      horizontalPadding: preset.horizontalPadding,
      spreadGap: spread.gap,
      spreadHorizontalPadding: spread.horizontalPadding,
      outerFraction: null,
    },
  };
}

/**
 * The numeric rem behind the resolved reading size. Exposed so the app's
 * content typography can scale off the book's size when it follows it — see
 * `content-typography.ts`.
 */
export function readerFontSizeRem(settings: ReaderTypographySettings): number {
  return resolveReaderTypography(settings).fontSizeRem;
}

/** Map a reading mode to the foliate renderer's `flow` + column attributes. */
export function layoutForReadingMode(mode: ReadingMode): {
  flow: "scrolled" | "paginated";
  maxColumnCount: number;
} {
  switch (mode) {
    case "paginated-single":
      return { flow: "paginated", maxColumnCount: 1 };
    case "paginated-double":
      return { flow: "paginated", maxColumnCount: 2 };
    case "scroll":
    default:
      return { flow: "scrolled", maxColumnCount: 1 };
  }
}

/** Keep the paginator's outer spacing and injected body padding in sync. */
export function readerLayoutSpacing(settings: ReaderTypographySettings, mode: ReadingMode) {
  const resolved = resolveReaderTypography(settings).margins;
  const spread = mode === "paginated-double";
  const horizontalPadding = spread ? resolved.spreadHorizontalPadding : resolved.horizontalPadding;
  // Custom mode asks for an outer side margin of p·width. The paginator turns
  // its gap attribute into half-gap columns at the outer edges plus a scaled
  // inner column gap, so the visible margin lands at g·W paginated and
  // g/(1−g)·W scrolled — scroll gets the inverse fraction of the request.
  const gap =
    resolved.outerFraction === null
      ? spread
        ? resolved.spreadGap
        : resolved.gap
      : mode === "scroll"
        ? `${(resolved.outerFraction / (1 + resolved.outerFraction)) * 100}%`
        : `${resolved.outerFraction * 100}%`;
  return {
    gap,
    margin: spread ? "20px" : "48px",
    bodyPadding: spread ? `1rem ${horizontalPadding} 1.5rem` : `2rem ${horizontalPadding} 4rem`,
  };
}

/**
 * Text measure (px) for foliate's `max-inline-size` attribute, derived from the
 * live reader width so the column is responsive. Capped to the container so it
 * never overflows a small window.
 *
 * The measure is per column, and foliate derives the column count from it
 * (`ceil(container / measure)` capped at max-column-count) — so the "fill"
 * preset divides by the columns that will actually render; a full-container
 * measure would collapse two-page mode to a single column.
 */
export function computeReaderMaxInlineSize(
  settings: ReaderTypographySettings,
  containerWidthPx: number,
  columnCount = 1,
): number {
  const { measureFraction } = resolveReaderTypography(settings).margins;
  const preferred =
    measureFraction === "fill" ? containerWidthPx / Math.max(1, columnCount) : measureFraction * containerWidthPx;
  const clamped = Math.max(MEASURE_MIN_REM * REM_PX, Math.min(preferred, MEASURE_MAX_REM * REM_PX));
  return Math.round(Math.min(clamped, containerWidthPx));
}

/**
 * Alignment rules for a preset.
 *
 * `book` emits nothing at all. Every other declaration in this sheet exists
 * to beat the publisher; this one deliberately yields to them, because the
 * right alignment depends on the script (justified CJK is correct, justified
 * unhyphenated English is not) and the publisher's stylesheet is the closest
 * thing to a statement of which script the book is set in.
 *
 * The forced presets reach `p, li, dd, blockquote` rather than every element,
 * so headings keep the alignment the publisher gave them — a centered chapter
 * title stays centered — and table cells and figcaptions keep the rules
 * further down this sheet.
 *
 * That protection is by tag, not by intent, so it is only as good as the
 * book's markup: a publisher who centers a caption as `<p class="Caption">`
 * (Atomic Habits does) gets it flattened along with the prose. Forcing an
 * alignment means overriding the book, and there is no selector for "the
 * author meant this one." The default exists so nobody pays that cost
 * without asking for it.
 */
function textAlignCss(align: ReaderTextAlign): string {
  if (align === "book") return "";
  return `
    body,
    body :where(p, li, dd, blockquote) {
      text-align: ${align} !important;
    }
`;
}

/**
 * First-line indent rules, or nothing at all.
 *
 * `book` — the resolved `null` — emits no rule and lets the publisher decide.
 * That restraint is deliberate, for the same reason as alignment: publishers
 * use text-indent for paragraph rhythm AND for negative hanging indents on
 * notes and verse, so a blanket `p { text-indent }` flattens every hanging
 * indent in the book. Forcing an indent means paying that cost, so it exists
 * only as an explicit user choice (`none`/`two`, or a custom em value).
 */
function textIndentCss(indent: string | null): string {
  if (indent === null) return "";
  return `
    body :where(p) {
      text-indent: ${indent} !important;
    }
`;
}

/**
 * Everything registry-dependent a reader stylesheet needs, resolved by the
 * caller: the palette behind the (possibly plugin-contributed) theme, any
 * `@font-face` rules to inline (curated download blobs or plugin folder
 * URLs), and the registered plugin font behind a `plugin:` font selection.
 */
export type ReaderContentAssets = {
  palette: ReaderPalette;
  fontFaceCss?: string;
  pluginFont?: PluginFontStackSource | null;
};

/**
 * Build the stylesheet injected into the foliate section iframe.
 *
 * `assets.fontFaceCss` carries the `@font-face` rules for the active webfont
 * (curated fonts with their on-demand blob URLs, plugin fonts with their
 * folder URLs) so the book renders in it; it's empty for system fonts, which
 * need no @font-face. See `curated-font-loader` / `plugin-theme`.
 */
export function buildReaderContentCss(settings: ReaderSettings, assets: ReaderContentAssets): string {
  const fontFaceCss = assets.fontFaceCss ?? "";
  const fontFamily = resolveReaderFontStack(settings.fontFamily, assets.pluginFont);
  const typography = resolveReaderTypography(settings);
  const fontSize = typography.fontSize;
  const fontWeight = READER_FONT_WEIGHTS[resolveReaderFontWeight(settings.fontWeight, settings.fontFamily)];
  const lineHeight = typography.lineHeight;
  const paragraphSpacing = typography.paragraphSpacing;
  const { bodyPadding } = readerLayoutSpacing(settings, settings.readingMode);
  const theme = assets.palette;

  // Must lead the sheet: @namespace is only honored before style rules (after
  // @charset / @import), and the footnote rules below select on the namespaced
  // `epub:type` attribute. A *prefixed* namespace leaves plain type selectors
  // (body, p, …) matching every namespace, as they do today.
  return `
    @namespace epub url("http://www.idpf.org/2007/ops");
    ${fontFaceCss}
    html {
      background: ${theme.background ? "transparent" : theme.bg} !important;
    }

    body {
      box-sizing: border-box !important;
      padding: ${bodyPadding} !important;
      color: ${theme.text} !important;
      background: ${theme.background ? "transparent" : theme.bg} !important;
      font-family: ${fontFamily} !important;
      font-size: ${fontSize} !important;
      font-weight: ${fontWeight} !important;
      line-height: ${lineHeight} !important;
    }
${textAlignCss(settings.textAlign)}${textIndentCss(typography.textIndent)}
    ${
      fontWeight > 700
        ? `
    /* Heavy body presets must not make semantic emphasis lighter than prose. */
    body :where(b, strong, h1, h2, h3, h4, h5, h6) {
      font-weight: ${fontWeight} !important;
    }
    `
        : ""
    }
    /* Publisher stylesheets routinely declare font-family directly on p / h1 /
       div / classes (often naming an embedded font), which beats inheritance
       from body — so the picked font must be forced onto every element, not
       just the root. :where() keeps specificity at the bare "body" level so
       the monospace and MathML exceptions below can still win by source order.
       (foliate appends this sheet after the publisher's, so equal-specificity
       !important conflicts also resolve our way.) */
    body :where(*) {
      font-family: ${fontFamily} !important;
    }

    /* Same story for color, and it is the one that breaks a book outright:
       calibre-converted EPUBs pin near-black on the span class that wraps
       every paragraph (".calibre_1 { color: rgb(23,23,23) }"), which beats
       body inheritance and leaves the whole book invisible on a dark page.
       Backgrounds go with it — a publisher's opaque white box under
       now-light text would just move the invisibility, and any box we do
       want (code, pre) is re-established by the later rules below.

       The cost is real: author-chosen text colors are flattened to the theme.
       That is the trade a page-color setting implies — the reader's palette
       decides contrast, not the publisher's.

       line-height joins them because a publisher's "p { line-height: 1.2em }"
       (Le Grand Meaulnes) makes the line-spacing setting inert — the body
       value changes and not one paragraph moves. font-size and font-weight
       deliberately do NOT: publishers express those relatively (em) or
       semantically (.bold), so flattening them would erase the book's
       emphasis. Overly small reading text gets a targeted floor below. The heading and pre
       line-heights below still win — same specificity, later in the sheet.

       text-align is not here either, but for the opposite reason: it is a
       user setting now, and its default defers to the book. See
       textAlignCss above. */
    body :where(*) {
      color: inherit !important;
      background-color: transparent !important;
      line-height: inherit !important;
    }

    /* MathML draws from the UA's math font; forcing a text face breaks
       formula rendering, so revert the override inside math subtrees. */
    math,
    math :where(*) {
      font-family: revert !important;
    }

    body > * {
      max-width: 100% !important;
    }

    /* The document pass marks actual reading text below this floor, including
       publisher spans used for quotes/notes without semantic markup. */
    body [data-ra-small-text] {
      font-size: calc(${fontSize} * 0.85) !important;
    }

    /* Converted books sometimes enlarge a superscript to compensate for a
       tiny parent, then shrink/enlarge its descendants again. Keep it relative
       to the corrected text, without touching SVG or MathML typography. */
    body :where(sup, sub):not(:where(svg *, math *)) {
      font-size: 0.75em !important;
      line-height: 0 !important;
    }

    body :where(sup, sub) :where(*):not(:where(svg *, math *)) {
      font-size: inherit !important;
    }

    /* TOC chapters can share a source file; file boundaries are not chapter
       boundaries. Attribute-only markers preserve the original CFI paths. */
    body [data-ra-chapter-start] {
      break-after: avoid !important;
    }

    body a[data-ra-chapter-start] {
      display: block !important;
      margin-bottom: 0 !important;
    }

    body [data-ra-chapter-start="next"] {
      ${
        settings.readingMode === "scroll"
          ? "margin-block-start: 4rem !important; padding-block-start: 2rem !important;"
          : "break-before: column !important;"
      }
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

    /* Media sitting on a text line — publisher glyph substitutes ("补字图"),
       inline icons — is marked data-ra-inline-media by the document pass and
       keeps the publisher's display and em sizing; only standalone artwork
       gets the block illustration treatment. :where() keeps zero specificity
       so later rules below (and test/publisher overrides) win as before. */
    :where(img, svg, video, canvas):where(:not([data-ra-inline-media])) {
      display: block !important;
      width: auto !important;
      max-width: min(100%, 32rem) !important;
      height: auto !important;
      margin: 1.75rem auto !important;
    }

    /* Image-only pages use publisher wrappers for positioning, not tabular
       data. Keep those nodes for CFI navigation, but give the artwork the
       available page area without prose spacing or table-cell borders. */
    html[data-foliate-image-page] body {
      line-height: 0 !important;
    }

    html[data-foliate-image-page] body :where(div, p, figure, table, thead, tbody, tfoot, tr, th, td, section, article, a, span):not(:where(svg *)) {
      display: block !important;
      width: auto !important;
      height: auto !important;
      min-width: 0 !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      line-height: 0 !important;
      break-before: auto !important;
      break-after: auto !important;
    }

    /* A non-breaking-space spacer still has glyph height in WebKit even with
       line-height: 0. Empty wrappers must not push full-page artwork down. */
    html[data-foliate-image-page] body :where(div, p, figure, table, thead, tbody, tfoot, tr, th, td, section, article, a, span):not(:where(svg *, :has(img, svg, video, canvas))),
    html[data-foliate-image-page] body > br {
      display: none !important;
    }

    html[data-foliate-image-page] body :where(img, svg, video, canvas) {
      margin: 0 auto !important;
    }

    /* 掌阅式内联脚注（<img zy-footnote="注文" class="epub-footnote">）：这是
       正文里的角标记号,不是插图 —— 保持行内、缩到文字大小。注文本身在
       点击弹层里（见 FoliateReaderView 的 zy-footnote 点击接线）。 */
    img[zy-footnote],
    img.epub-footnote,
    img.zhangyue-footnote {
      display: inline-block !important;
      width: auto !important;
      height: 0.85em !important;
      margin: 0 0.15em !important;
      vertical-align: -0.05em !important;
      cursor: pointer !important;
    }

    /* EPUB 3 内联注释体（<aside epub:type="footnote">…</aside> 直接躺在正文
       段落之间）：规范要求阅读器把它们藏起来,只在 noteref 被点击时弹出 ——
       foliate 的 FootnoteHandler 正是这么做的（它对这种目标还专门回报
       hidden: true）。出版方 CSS 通常不自己隐藏（多看导出的 EPUB 甚至显式写
       display: block）,所以隐藏得由我们来做,否则整章注文混在正文里。

       弹层不受影响：它在另一个 foliate-view 里重新加载片段,而且抽取的是
       aside 的子节点,我们注入的样式也不进那个 view。

       只匹配 aside —— <section epub:type="footnote"> 是成章的尾注页,该照常
       显示。两种属性写法都列上：XHTML 解析走命名空间,HTML 解析下属性名就是
       字面量 "epub:type"。 */
    aside[epub|type~="footnote"],
    aside[epub|type~="endnote"],
    aside[epub|type~="rearnote"],
    aside[epub|type~="note"],
    aside[epub\\:type~="footnote"],
    aside[epub\\:type~="endnote"],
    aside[epub\\:type~="rearnote"],
    aside[epub\\:type~="note"],
    aside[role~="doc-footnote"],
    aside[role~="doc-endnote"] {
      display: none !important;
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

    /* Must stay below the body-wide font-family override: equal specificity,
       so these win by source order. pre is listed for its bare text nodes —
       the UA's monospace default loses to the author-important override. */
    pre,
    code,
    kbd,
    samp {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace !important;
    }

    code,
    kbd,
    samp {
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
      font-weight: ${Math.max(600, fontWeight)} !important;
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
export function getReaderPreviewStyle(
  settings: ReaderSettings,
  assets: Pick<ReaderContentAssets, "palette" | "pluginFont">,
): CSSProperties & {
  "--ra-reader-preview-paragraph-spacing": string;
  "--ra-reader-preview-text-indent": string;
} {
  const theme = assets.palette;
  const typography = resolveReaderTypography(settings);
  return {
    "--ra-reader-preview-paragraph-spacing": typography.paragraphSpacing,
    // "0" when the publisher's own indent is followed — the preview text is
    // ours, so following it means no indent here either way.
    "--ra-reader-preview-text-indent": typography.textIndent ?? "0",
    backgroundColor: theme.bg,
    color: theme.text,
    fontFamily: resolveReaderFontStack(settings.fontFamily, assets.pluginFont),
    fontSize: typography.fontSize,
    fontWeight: READER_FONT_WEIGHTS[resolveReaderFontWeight(settings.fontWeight, settings.fontFamily)],
    lineHeight: typography.lineHeight,
    // The preview text is ours, so `book` — "whatever the publisher chose" —
    // has no publisher to defer to; it shows the unforced default.
    textAlign: settings.textAlign === "justify" ? "justify" : "start",
  };
}
