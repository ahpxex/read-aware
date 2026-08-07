import { describe, expect, test } from "bun:test";
import { DEFAULT_READER_PREFERENCES } from "./reader-settings";
import {
  DEFAULT_CONTENT_TYPOGRAPHY,
  activeContentFont,
  resolveContentTypography,
  type ContentTypographySettings,
} from "./content-typography";

const reader = DEFAULT_READER_PREFERENCES;

const detached = (over: Partial<ContentTypographySettings> = {}): ContentTypographySettings => ({
  ...DEFAULT_CONTENT_TYPOGRAPHY,
  followReader: false,
  ...over,
});

describe("resolveContentTypography", () => {
  test("following at the reader's default size changes nothing", () => {
    // The anchor that makes "follow" the safe default: turning it on out of
    // the box must not resize a single reply.
    const resolved = resolveContentTypography(DEFAULT_CONTENT_TYPOGRAPHY, reader);

    expect(resolved.fontSize).toBe("0.875rem");
  });

  test("following scales content with the reading size", () => {
    const bigger = resolveContentTypography(DEFAULT_CONTENT_TYPOGRAPHY, {
      ...reader,
      fontSize: "x-large",
    });
    const smaller = resolveContentTypography(DEFAULT_CONTENT_TYPOGRAPHY, {
      ...reader,
      fontSize: "x-small",
    });

    expect(Number.parseFloat(bigger.fontSize)).toBeGreaterThan(0.875);
    expect(Number.parseFloat(smaller.fontSize)).toBeLessThan(0.875);
  });

  test("the followed size stays inside a usable band at both extremes", () => {
    const hugest = resolveContentTypography(DEFAULT_CONTENT_TYPOGRAPHY, {
      ...reader,
      fontSize: "xxx-large",
    });
    const tiniest = resolveContentTypography(DEFAULT_CONTENT_TYPOGRAPHY, {
      ...reader,
      fontSize: "xx-small",
    });

    expect(Number.parseFloat(hugest.fontSize)).toBeLessThanOrEqual(1.375);
    expect(Number.parseFloat(tiniest.fontSize)).toBeGreaterThanOrEqual(0.75);
  });

  test("following takes the family and line spacing from the reader", () => {
    const resolved = resolveContentTypography(DEFAULT_CONTENT_TYPOGRAPHY, {
      ...reader,
      fontFamily: "system:Georgia",
      lineSpacing: "relaxed",
    });

    expect(resolved.fontFamily).toContain("Georgia");
    expect(resolved.lineHeight).toBe("1.9");
  });

  test("a detached setting ignores the reader entirely", () => {
    const resolved = resolveContentTypography(
      detached({ fontSize: "x-large", lineSpacing: "compact" }),
      { ...reader, fontSize: "xxx-large", lineSpacing: "relaxed" },
    );

    expect(resolved.fontSize).toBe("1.0625rem");
    expect(resolved.lineHeight).toBe("1.45");
  });

  test("a null family means the app's own sans — no stack is written", () => {
    const resolved = resolveContentTypography(detached({ fontFamily: null }), reader);

    expect(resolved.fontFamily).toBeNull();
  });

  test("the followed size never writes a float with a tail of digits", () => {
    for (const fontSize of ["xx-small", "small", "large", "xx-large"] as const) {
      const { fontSize: out } = resolveContentTypography(DEFAULT_CONTENT_TYPOGRAPHY, {
        ...reader,
        fontSize,
      });

      expect(out).toMatch(/^\d+(\.\d{1,4})?rem$/);
    }
  });
});

describe("activeContentFont", () => {
  test("reports the reader's font while following, so the loader fetches it", () => {
    expect(activeContentFont(DEFAULT_CONTENT_TYPOGRAPHY, reader)).toBe(reader.fontFamily);
  });

  test("reports the detached font once detached", () => {
    expect(activeContentFont(detached({ fontFamily: "curated:lora" }), reader)).toBe(
      "curated:lora",
    );
  });
});
