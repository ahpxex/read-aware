import { describe, expect, test } from "bun:test";
import { DEFAULT_READER_SETTINGS, type ReaderParagraphSpacing } from "./reader-settings";
import { BUILTIN_READER_PALETTES } from "./reader-theme";
import { buildReaderContentCss, getReaderPreviewStyle } from "./reader-css";

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
