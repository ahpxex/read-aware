import { describe, expect, test } from "bun:test";
import { DEFAULT_READER_SETTINGS, type ReaderParagraphSpacing } from "./reader-settings";
import { BUILTIN_READER_PALETTES } from "./reader-theme";
import { getReaderPreviewStyle } from "./reader-css";

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
