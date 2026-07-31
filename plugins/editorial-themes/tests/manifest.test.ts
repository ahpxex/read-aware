import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import manifest from "../manifest.json";

/**
 * The host validates the manifest at install/activation with strict grammars
 * (apps/web features/plugins/lib/plugin-theme.ts). These tests keep this
 * plugin honest against the same rules, so a palette tweak that would be
 * rejected at runtime fails here first.
 */

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC_COLOR = /^(?:rgb|rgba|hsl|hsla)\(\s*[\d.,%\s/-]+\)$/;

function isThemeColor(value: string): boolean {
  return HEX_COLOR.test(value) || FUNC_COLOR.test(value);
}

describe("editorial-themes manifest", () => {
  test("declares the ui:themes permission", () => {
    expect(manifest.permissions).toContain("ui:themes");
  });

  test("every font file exists and is a plain relative woff2 path", () => {
    for (const font of manifest.fonts) {
      expect(font.files.length).toBeGreaterThan(0);
      for (const file of font.files) {
        expect(file.path).toMatch(/^(?!\.)[A-Za-z0-9._-]+(\/(?!\.)[A-Za-z0-9._-]+)*\.woff2$/);
        expect(existsSync(join(import.meta.dir, "..", file.path))).toBe(true);
      }
    }
  });

  test("every color passes the host's strict color grammar", () => {
    for (const theme of manifest.themes) {
      for (const value of Object.values(theme.app ?? {})) {
        expect(isThemeColor(value)).toBe(true);
      }
      for (const value of Object.values(theme.reader?.palette ?? {})) {
        expect(isThemeColor(value)).toBe(true);
      }
    }
  });

  test("themes cover both polarities and reference a declared font", () => {
    const fontIds = new Set(manifest.fonts.map((font) => font.id));
    const polarities = new Set(manifest.themes.map((theme) => theme.polarity));
    expect(polarities).toEqual(new Set(["light", "dark"]));
    for (const theme of manifest.themes) {
      const family = theme.reader?.typography?.fontFamily;
      if (family?.startsWith("plugin:")) {
        expect(fontIds.has(family.slice("plugin:".length))).toBe(true);
      }
      // The six-color palette is complete.
      expect(Object.keys(theme.reader?.palette ?? {}).sort()).toEqual(
        ["bg", "faint", "muted", "rule", "selection", "text"],
      );
    }
  });
});
