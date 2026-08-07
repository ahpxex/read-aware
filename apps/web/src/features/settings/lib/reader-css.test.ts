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
