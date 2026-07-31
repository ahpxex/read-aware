import { describe, expect, test } from "bun:test";
import {
  applyReaderThemeSelection,
  BUILTIN_READER_PALETTES,
  resolveReaderPalette,
} from "./reader-theme";
import {
  DEFAULT_READER_PREFERENCES,
  normalizeReaderTheme,
} from "./reader-settings";
import type { RegisteredPluginTheme } from "../../plugins/lib/plugin-types";

const NOCTURNE: RegisteredPluginTheme = {
  key: "editorial-themes:nocturne",
  pluginId: "editorial-themes",
  pluginName: "Editorial Themes",
  id: "nocturne",
  name: "Nocturne",
  polarity: "dark",
  reader: {
    palette: {
      bg: "#161a22",
      text: "#ccd2dd",
      selection: "rgba(154, 162, 177, 0.28)",
      rule: "rgba(204, 210, 221, 0.18)",
      faint: "rgba(204, 210, 221, 0.07)",
      muted: "rgba(204, 210, 221, 0.55)",
    },
    typography: {
      fontFamily: "plugin:editorial-themes:eb-garamond",
      fontSize: "large",
      lineSpacing: "comfortable",
    },
  },
};

describe("resolveReaderPalette", () => {
  test("built-ins resolve from the fixed table", () => {
    expect(resolveReaderPalette("warm", [])).toBe(BUILTIN_READER_PALETTES.warm);
    expect(resolveReaderPalette("dark", [NOCTURNE])).toBe(BUILTIN_READER_PALETTES.dark);
  });

  test("a registered plugin theme resolves to its palette", () => {
    expect(resolveReaderPalette("plugin:editorial-themes:nocturne", [NOCTURNE]).bg).toBe(
      "#161a22",
    );
  });

  test("a dangling plugin ref falls back to warm", () => {
    expect(resolveReaderPalette("plugin:gone:theme", [NOCTURNE])).toBe(
      BUILTIN_READER_PALETTES.warm,
    );
  });

  test("an app-only theme does not claim the reader mount", () => {
    const appOnly: RegisteredPluginTheme = {
      ...NOCTURNE,
      reader: undefined,
      app: { paper: "#14171e" },
    };
    expect(
      resolveReaderPalette("plugin:editorial-themes:nocturne", [appOnly]),
    ).toBe(BUILTIN_READER_PALETTES.warm);
  });
});

describe("applyReaderThemeSelection", () => {
  test("built-in selection only switches the theme", () => {
    const next = applyReaderThemeSelection(DEFAULT_READER_PREFERENCES, "dark", [NOCTURNE]);
    expect(next.theme).toBe("dark");
    expect(next.fontFamily).toBe(DEFAULT_READER_PREFERENCES.fontFamily);
  });

  test("plugin selection seeds its typography preset", () => {
    const next = applyReaderThemeSelection(
      DEFAULT_READER_PREFERENCES,
      "plugin:editorial-themes:nocturne",
      [NOCTURNE],
    );
    expect(next.theme).toBe("plugin:editorial-themes:nocturne");
    expect(next.fontFamily).toBe("plugin:editorial-themes:eb-garamond");
    expect(next.fontSize).toBe("large");
    expect(next.lineSpacing).toBe("comfortable");
    // Undeclared axes keep the user's values.
    expect(next.paragraphSpacing).toBe(DEFAULT_READER_PREFERENCES.paragraphSpacing);
  });

  test("selecting a dangling ref keeps the settings untouched beyond the theme", () => {
    const next = applyReaderThemeSelection(DEFAULT_READER_PREFERENCES, "plugin:gone:x", []);
    expect(next.theme).toBe("plugin:gone:x");
    expect(next.fontFamily).toBe(DEFAULT_READER_PREFERENCES.fontFamily);
  });
});

describe("normalizeReaderTheme", () => {
  test("keeps built-ins, auto, and well-formed plugin refs", () => {
    expect(normalizeReaderTheme("auto")).toBe("auto");
    expect(normalizeReaderTheme("dark")).toBe("dark");
    expect(normalizeReaderTheme("plugin:editorial-themes:nocturne")).toBe(
      "plugin:editorial-themes:nocturne",
    );
  });

  test("coerces junk to the default", () => {
    expect(normalizeReaderTheme("sepia")).toBe(DEFAULT_READER_PREFERENCES.theme);
    expect(normalizeReaderTheme("plugin:broken")).toBe(DEFAULT_READER_PREFERENCES.theme);
    expect(normalizeReaderTheme(42)).toBe(DEFAULT_READER_PREFERENCES.theme);
  });
});
