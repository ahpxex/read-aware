import { describe, expect, test } from "bun:test";
import { fixedLayoutPageColors } from "./fixed-layout-colors";
import { BUILTIN_READER_PALETTES } from "../../settings/lib/reader-theme";
import type { ReaderPalette } from "../../settings/lib/reader-theme";

const palette = (bg: string, text: string): ReaderPalette => ({
  bg,
  text,
  selection: "rgba(0,0,0,0.2)",
  rule: "rgba(0,0,0,0.14)",
  faint: "rgba(0,0,0,0.05)",
  muted: "rgba(0,0,0,0.55)",
});

describe("fixedLayoutPageColors", () => {
  test("light palettes only tint the paper, so ink and photographs survive", () => {
    for (const theme of ["light", "warm"] as const) {
      const colors = fixedLayoutPageColors(BUILTIN_READER_PALETTES[theme], "theme");
      expect(colors).toEqual({ background: BUILTIN_READER_PALETTES[theme].bg });
      expect(colors?.foreground).toBeUndefined();
    }
  });

  test("a dark palette asks for the tonal remap", () => {
    const dark = BUILTIN_READER_PALETTES.dark;
    expect(fixedLayoutPageColors(dark, "theme")).toEqual({
      background: dark.bg,
      foreground: dark.text,
    });
  });

  test("darkness is measured, not named — a plugin's dark palette remaps too", () => {
    expect(fixedLayoutPageColors(palette("#10233b", "#cfd8e3"), "theme")).toEqual({
      background: "#10233b",
      foreground: "#cfd8e3",
    });
  });

  test("a light palette with mid-tone ink still only tints", () => {
    expect(fixedLayoutPageColors(palette("#fdf6e3", "#657b83"), "theme")).toEqual({
      background: "#fdf6e3",
    });
  });

  test("shorthand hex is understood", () => {
    expect(fixedLayoutPageColors(palette("#111", "#eee"), "theme")).toEqual({
      background: "#111",
      foreground: "#eee",
    });
  });

  test("an unmeasurable palette tints rather than throwing away color", () => {
    // Losing color to a remap we could not justify is the worse failure.
    expect(fixedLayoutPageColors(palette("oklch(0.2 0.02 250)", "#eee"), "theme")).toEqual({
      background: "oklch(0.2 0.02 250)",
    });
  });

  test("`original` renders the page as authored, whatever the palette", () => {
    expect(fixedLayoutPageColors(BUILTIN_READER_PALETTES.dark, "original")).toBeNull();
    expect(fixedLayoutPageColors(BUILTIN_READER_PALETTES.warm, "original")).toBeNull();
  });
});
