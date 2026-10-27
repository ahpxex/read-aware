import { describe, expect, test } from "bun:test";
import {
  customTypographyFromPresets,
  DEFAULT_READER_SETTINGS,
  type ReaderParagraphSpacing,
  type ReaderSettings,
} from "./reader-settings";
import { BUILTIN_READER_PALETTES } from "./reader-theme";
import {
  buildReaderContentCss,
  computeReaderMaxInlineSize,
  getReaderPreviewStyle,
  readerLayoutSpacing,
  resolveReaderTypography,
} from "./reader-css";

describe("buildReaderContentCss", () => {
  const build = (fontFaceCss?: string) =>
    buildReaderContentCss(DEFAULT_READER_SETTINGS, {
      palette: BUILTIN_READER_PALETTES.dark,
      fontFaceCss,
    });

  test("declares the epub namespace before any rule, even with @font-face", () => {
    const css = build("@font-face { font-family: X; src: url(x.woff2); }");
    const namespaceAt = css.indexOf("@namespace");

    expect(namespaceAt).toBeGreaterThanOrEqual(0);
    expect(namespaceAt).toBeLessThan(css.indexOf("@font-face"));
    expect(namespaceAt).toBeLessThan(css.indexOf("html {"));
  });

  test("forces the theme color onto every element, so a pinned near-black loses", () => {
    const css = build();

    expect(css).toContain("color: inherit !important");
    expect(css).toContain("background-color: transparent !important");
    expect(css).toContain("line-height: inherit !important");
  });

  test("leaves the heading line-heights to win by source order", () => {
    const css = build();

    expect(css.indexOf("line-height: inherit")).toBeLessThan(css.indexOf("h1 {"));
    expect(css.indexOf("line-height: inherit")).toBeLessThan(css.indexOf("pre {"));
  });

  test("does not flatten font-size or font-weight — those carry the book's emphasis", () => {
    // Two blocks share this selector; the theme one is the block with color.
    const blanket =
      build()
        .match(/body :where\(\*\) \{[^}]*\}/g)
        ?.find((block) => block.includes("color: inherit")) ?? "";

    expect(blanket).toContain("line-height: inherit");
    expect(blanket).not.toContain("font-size");
    expect(blanket).not.toContain("font-weight");
  });

  test("the default alignment declares nothing, leaving the book's own", () => {
    const css = buildReaderContentCss(
      { ...DEFAULT_READER_SETTINGS, textAlign: "book" },
      { palette: BUILTIN_READER_PALETTES.warm },
    );

    // Not "defaults to start" — the body-level rule is genuinely absent, so a
    // publisher's justify stands and nothing has to out-specify it. (Table
    // cells and captions keep their own alignment; they are not the setting.)
    expect(css).not.toMatch(/body,\s*body :where\(p/);
    expect(css).not.toMatch(/text-align:\s*justify/);
  });

  test("a forced alignment reaches body text but spares headings", () => {
    for (const align of ["start", "justify"] as const) {
      const css = buildReaderContentCss(
        { ...DEFAULT_READER_SETTINGS, textAlign: align },
        { palette: BUILTIN_READER_PALETTES.warm },
      );
      const rule = css.match(/body,\s*body :where\([^)]*\) \{[^}]*\}/)?.[0] ?? "";

      expect(rule).toContain(`text-align: ${align} !important`);
      expect(rule).toContain("p, li, dd, blockquote");
      // A centered chapter title must survive the setting.
      expect(rule).not.toMatch(/\bh[1-6]\b/);
    }
  });

  test("the centered caption rule still wins over a forced alignment", () => {
    const css = buildReaderContentCss(
      { ...DEFAULT_READER_SETTINGS, textAlign: "justify" },
      { palette: BUILTIN_READER_PALETTES.warm },
    );

    expect(css.indexOf("text-align: justify")).toBeLessThan(css.indexOf("figcaption"));
  });

  test("hides EPUB 3 inline note asides (both attribute spellings)", () => {
    const css = build();

    expect(css).toContain('aside[epub|type~="footnote"]');
    expect(css).toContain('aside[epub\\:type~="footnote"]');
    expect(css).toContain('aside[role~="doc-footnote"]');
    // Section-level notes are whole endnote pages — they must stay visible.
    expect(css).not.toContain("section[epub|type");
  });
});

describe("getReaderPreviewStyle", () => {
  const spacings = [
    ["tight", "0.6rem"],
    ["normal", "1.25rem"],
    ["loose", "1.9rem"],
  ] as const satisfies readonly (readonly [ReaderParagraphSpacing, string])[];

  for (const [paragraphSpacing, expected] of spacings) {
    test(`maps ${paragraphSpacing} paragraph spacing into the preview`, () => {
      const style = getReaderPreviewStyle(
        { ...DEFAULT_READER_SETTINGS, paragraphSpacing },
        { palette: BUILTIN_READER_PALETTES.warm },
      );

      expect(style["--ra-reader-preview-paragraph-spacing"]).toBe(expected);
    });
  }
});

const CUSTOM: ReaderSettings = {
  ...DEFAULT_READER_SETTINGS,
  typographyMode: "custom",
  customTypography: {
    fontSizePx: 21,
    lineHeight: 1.75,
    paragraphSpacingEm: 0.8,
    pageMarginPercent: 10,
    textIndentEm: 2,
  },
};

describe("resolveReaderTypography", () => {
  test("preset output is the tuned preset values", () => {
    const resolved = resolveReaderTypography(DEFAULT_READER_SETTINGS);
    expect(resolved.fontSize).toBe("1.0625rem");
    expect(resolved.lineHeight).toBe("1.85");
    expect(resolved.paragraphSpacing).toBe("1.25rem");
    expect(resolved.textIndent).toBeNull();
    expect(resolved.margins.outerFraction).toBeNull();
    expect(resolved.margins.measureFraction).not.toBe("fill");
  });

  test("custom mode emits the exact numbers", () => {
    const resolved = resolveReaderTypography(CUSTOM);
    expect(resolved.fontSize).toBe("21px");
    expect(resolved.lineHeight).toBe("1.75");
    expect(resolved.paragraphSpacing).toBe("0.8em");
    expect(resolved.textIndent).toBe("2em");
    expect(resolved.margins.measureFraction).toBe("fill");
    expect(resolved.margins.outerFraction).toBe(0.1);
  });

  test("custom mode with no stored object seeds from the live presets — no visual jump", () => {
    const seeded = resolveReaderTypography({ ...DEFAULT_READER_SETTINGS, typographyMode: "custom" });
    const preset = resolveReaderTypography(DEFAULT_READER_SETTINGS);
    expect(seeded.fontSize).toBe("17px");
    expect(seeded.lineHeight).toBe(preset.lineHeight);
    expect(customTypographyFromPresets(DEFAULT_READER_SETTINGS).fontSizePx).toBe(17);
  });

  test("a large preset seeds the same size so switching modes does not move the text", () => {
    const large = { ...DEFAULT_READER_SETTINGS, fontSize: "large" as const };
    const seeded = resolveReaderTypography({ ...large, typographyMode: "custom" });
    expect(seeded.fontSize).toBe("19px");
    expect(Number.parseFloat(seeded.fontSize)).toBeCloseTo(resolveReaderTypography(large).fontSizeRem * 16);
  });
});

describe("buildReaderContentCss custom typography", () => {
  const build = (settings: ReaderSettings) =>
    buildReaderContentCss(settings, { palette: BUILTIN_READER_PALETTES.warm });

  test("emits the px font-size, unitless line-height and em paragraph spacing", () => {
    const css = build(CUSTOM);
    expect(css).toContain("font-size: 21px !important");
    expect(css).toContain("line-height: 1.75 !important");
    expect(css).toContain("margin: 0 0 0.8em 0 !important");
  });

  test("emits a text-indent rule for a custom em value", () => {
    expect(build(CUSTOM)).toMatch(/body :where\(p\) \{\s*text-indent: 2em !important;\s*\}/);
  });

  test("book emits no indent rule; none forces 0; two forces 2em", () => {
    const buildIndent = (extra: Partial<ReaderSettings>) => build({ ...CUSTOM, ...extra });
    expect(build({ ...CUSTOM, customTypography: { ...CUSTOM.customTypography!, textIndentEm: null } })).not.toContain(
      "text-indent",
    );
    expect(buildIndent({ textIndent: "book", typographyMode: "preset" })).not.toContain("text-indent");
    expect(buildIndent({ textIndent: "none", typographyMode: "preset" })).toContain("text-indent: 0 !important");
    expect(buildIndent({ textIndent: "two", typographyMode: "preset" })).toContain("text-indent: 2em !important");
  });

  test("preset defaults produce the same stylesheet as before the seam", () => {
    const css = build(DEFAULT_READER_SETTINGS);
    expect(css).toContain("font-size: 1.0625rem !important");
    expect(css).toContain("line-height: 1.85 !important");
    expect(css).toContain("margin: 0 0 1.25rem 0 !important");
    expect(css).not.toContain("text-indent");
  });
});

describe("readerLayoutSpacing / computeReaderMaxInlineSize custom margins", () => {
  test("custom pageMarginPercent maps to a matching gap (paginated) and its scroll inverse", () => {
    expect(readerLayoutSpacing(CUSTOM, "paginated-single").gap).toBe("10%");
    expect(readerLayoutSpacing(CUSTOM, "paginated-double").gap).toBe("10%");
    // scroll measures g/(1-g) of the width: the inverse fraction lands the
    // same visible margin.
    expect(readerLayoutSpacing(CUSTOM, "scroll").gap).toBe(`${(0.1 / 1.1) * 100}%`);
  });

  test("custom fill measure divides by the spread columns", () => {
    expect(computeReaderMaxInlineSize(CUSTOM, 1200, 1)).toBe(1200);
    expect(computeReaderMaxInlineSize(CUSTOM, 1200, 2)).toBe(600);
    expect(computeReaderMaxInlineSize(CUSTOM, 2000, 1)).toBe(84 * 16);
  });
});
