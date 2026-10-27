import { beforeEach, describe, expect, test } from "bun:test";
import {
  customTypographyFromPresets,
  DEFAULT_READER_PREFERENCES,
  getReaderPreferences,
  normalizeCustomTypography,
  READER_PREFERENCES_KEY,
  saveReaderPreferences,
} from "./reader-settings";
import { getReaderOverrides, READER_OVERRIDES_KEY, saveReaderOverrides } from "./reader-overrides";
import { installFileGlobals, memoryStorage } from "../../../../tests/helpers/file-globals";

const storage = new Map<string, string>();
installFileGlobals({ localStorage: memoryStorage(storage) });

beforeEach(() => storage.clear());

describe("normalizeCustomTypography", () => {
  test("clamps to the limits and snaps to the step", () => {
    expect(
      normalizeCustomTypography({
        fontSizePx: 99,
        lineHeight: 1.234,
        paragraphSpacingEm: 0.84,
        pageMarginPercent: -3,
        textIndentEm: 2.24,
      }),
    ).toEqual({ fontSizePx: 40, lineHeight: 1.25, paragraphSpacingEm: 0.8, pageMarginPercent: 0, textIndentEm: 2 });
  });

  test("rejects non-objects and any non-finite field", () => {
    for (const junk of [
      null,
      4,
      "x",
      [],
      { fontSizePx: 18 },
      { fontSizePx: Number.NaN, lineHeight: 2, paragraphSpacingEm: 1, pageMarginPercent: 5, textIndentEm: null },
    ]) {
      expect(normalizeCustomTypography(junk)).toBeUndefined();
    }
  });

  test("a null indent survives; a missing one drops the object", () => {
    const valid = { fontSizePx: 18, lineHeight: 1.8, paragraphSpacingEm: 1, pageMarginPercent: 8, textIndentEm: null };
    expect(normalizeCustomTypography(valid)).toEqual(valid);
    expect(normalizeCustomTypography({ ...valid, textIndentEm: undefined })).toBeUndefined();
  });
});

describe("customTypographyFromPresets", () => {
  test("seeds the exact values behind the presets", () => {
    expect(
      customTypographyFromPresets({
        ...DEFAULT_READER_PREFERENCES,
        fontSize: "medium",
        lineSpacing: "comfortable",
        paragraphSpacing: "normal",
        pageMargins: "wide",
        textIndent: "two",
      }),
    ).toEqual({ fontSizePx: 17, lineHeight: 1.85, paragraphSpacingEm: 1.2, pageMarginPercent: 14, textIndentEm: 2 });
  });
});

describe("reader preferences persistence", () => {
  test("round-trips the new fields through getReaderPreferences", () => {
    saveReaderPreferences({
      ...DEFAULT_READER_PREFERENCES,
      typographyMode: "custom",
      textIndent: "two",
      customTypography: {
        fontSizePx: 21,
        lineHeight: 1.75,
        paragraphSpacingEm: 0.8,
        pageMarginPercent: 10,
        textIndentEm: 2,
      },
    });
    const prefs = getReaderPreferences();
    expect(prefs.typographyMode).toBe("custom");
    expect(prefs.textIndent).toBe("two");
    expect(prefs.customTypography).toEqual({
      fontSizePx: 21,
      lineHeight: 1.75,
      paragraphSpacingEm: 0.8,
      pageMarginPercent: 10,
      textIndentEm: 2,
    });
  });

  test("a legacy store without the new fields reads as preset/book/undefined", () => {
    const { typographyMode: _m, textIndent: _i, customTypography: _c, ...legacy } = DEFAULT_READER_PREFERENCES;
    storage.set(READER_PREFERENCES_KEY, JSON.stringify(legacy));
    const prefs = getReaderPreferences();
    expect(prefs.typographyMode).toBe("preset");
    expect(prefs.textIndent).toBe("book");
    expect(prefs.customTypography).toBeUndefined();
  });

  test("junk values normalize instead of crashing", () => {
    storage.set(
      READER_PREFERENCES_KEY,
      JSON.stringify({ typographyMode: "bogus", textIndent: 9, customTypography: "nope" }),
    );
    const prefs = getReaderPreferences();
    expect(prefs.typographyMode).toBe("preset");
    expect(prefs.textIndent).toBe("book");
    expect(prefs.customTypography).toBeUndefined();
  });
});

describe("reader overrides persistence", () => {
  test("book overrides normalize the new fields too", () => {
    saveReaderOverrides({
      "book-1": {
        scope: "book",
        settings: {
          ...DEFAULT_READER_PREFERENCES,
          typographyMode: "bogus" as never,
          customTypography: { fontSizePx: 5 } as never,
        },
      },
    });
    const settings = getReaderOverrides()["book-1"]!.settings;
    expect(settings.typographyMode).toBe("preset");
    expect(settings.customTypography).toBeUndefined();
  });

  test("legacy overrides without the fields keep working", () => {
    const { typographyMode: _m, textIndent: _i, ...legacy } = DEFAULT_READER_PREFERENCES;
    storage.set(READER_OVERRIDES_KEY, JSON.stringify({ b: { scope: "book", settings: legacy } }));
    const settings = getReaderOverrides()["b"]!.settings;
    expect(settings.typographyMode).toBe("preset");
    expect(settings.textIndent).toBe("book");
  });
});
