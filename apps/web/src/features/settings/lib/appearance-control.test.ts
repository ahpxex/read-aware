import { beforeEach, describe, expect, test } from "bun:test";
import { getDefaultStore } from "jotai";
import type { RegisteredPluginTheme } from "../../plugins/lib/plugin-types";
import { pluginThemesAtom } from "../../plugins/state/plugin-store";
import { appSettingsAtom, readerPreferencesAtom } from "../../../state/ui";
import { DEFAULT_APP_SETTINGS } from "./app-settings";
import { DEFAULT_READER_PREFERENCES } from "./reader-settings";
import {
  listAppearanceThemes,
  readAppearanceState,
  setAppThemePreference,
  setReaderThemePreference,
} from "./appearance-control";

/** Skins the app only — the reader surface must not offer it. */
const APP_ONLY: RegisteredPluginTheme = {
  key: "editorial-themes:gutenberg",
  pluginId: "editorial-themes",
  pluginName: "Editorial Themes",
  id: "gutenberg",
  name: "Gutenberg",
  polarity: "light",
  app: { paper: "#f4ecd9" },
};

/** Skins the book page only, and carries a typography preset. */
const READER_ONLY: RegisteredPluginTheme = {
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
    typography: { fontSize: "large", lineSpacing: "relaxed" },
  },
};

/** The preference atoms persist through `localKV`, which wants a web store. */
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
  },
});

const store = getDefaultStore();

beforeEach(() => {
  storage.clear();
  store.set(pluginThemesAtom, [APP_ONLY, READER_ONLY]);
  store.set(appSettingsAtom, { ...DEFAULT_APP_SETTINGS });
  store.set(readerPreferencesAtom, { ...DEFAULT_READER_PREFERENCES });
});

describe("listAppearanceThemes", () => {
  test("built-ins carry the surfaces they belong to, in picker order", () => {
    const options = listAppearanceThemes([]);
    expect(options.map((option) => option.value)).toEqual([
      "system",
      "auto",
      "light",
      "warm",
      "dark",
    ]);
    const byValue = Object.fromEntries(options.map((option) => [option.value, option]));
    expect(byValue.system.surfaces).toEqual(["app"]);
    expect(byValue.auto.surfaces).toEqual(["reader"]);
    // `light` and `dark` exist on both surfaces and must appear once, not twice.
    expect(byValue.light.surfaces).toEqual(["app", "reader"]);
    expect(byValue.dark.surfaces).toEqual(["app", "reader"]);
    expect(byValue.warm.surfaces).toEqual(["reader"]);
    expect(options.filter((option) => option.value === "light")).toHaveLength(1);
  });

  test("plugin themes are listed under the parts they declare", () => {
    const options = listAppearanceThemes();
    const gutenberg = options.find(
      (option) => option.value === "plugin:editorial-themes:gutenberg",
    );
    const nocturne = options.find(
      (option) => option.value === "plugin:editorial-themes:nocturne",
    );
    expect(gutenberg?.surfaces).toEqual(["app"]);
    expect(gutenberg?.pluginId).toBe("editorial-themes");
    expect(gutenberg?.polarity).toBe("light");
    expect(nocturne?.surfaces).toEqual(["reader"]);
  });

  test("only the two values that follow something else have no polarity", () => {
    const noPolarity = listAppearanceThemes([])
      .filter((option) => option.polarity === null)
      .map((option) => option.value);
    expect(noPolarity.sort()).toEqual(["auto", "system"]);
  });
});

describe("setAppThemePreference", () => {
  test("stores a built-in and a plugin skin", () => {
    setAppThemePreference("dark");
    expect(store.get(appSettingsAtom).theme).toBe("dark");
    setAppThemePreference("plugin:editorial-themes:gutenberg");
    expect(store.get(appSettingsAtom).theme).toBe("plugin:editorial-themes:gutenberg");
  });

  test("refuses a value the app surface does not offer", () => {
    // Reader-only built-in.
    expect(() => setAppThemePreference("warm")).toThrow(/not an app theme/);
    // A theme whose plugin declares no app part.
    expect(() => setAppThemePreference("plugin:editorial-themes:nocturne")).toThrow(
      /not an app theme/,
    );
    // A ref no enabled plugin backs.
    expect(() => setAppThemePreference("plugin:gone:missing")).toThrow(/not an app theme/);
    expect(store.get(appSettingsAtom).theme).toBe(DEFAULT_APP_SETTINGS.theme);
  });

  test("leaves the rest of the appearance settings alone", () => {
    store.set(appSettingsAtom, { theme: "system", motion: "reduced" });
    setAppThemePreference("light");
    expect(store.get(appSettingsAtom)).toEqual({ theme: "light", motion: "reduced" });
  });
});

describe("setReaderThemePreference", () => {
  test("selecting a plugin theme applies its typography preset", () => {
    setReaderThemePreference("plugin:editorial-themes:nocturne");
    const prefs = store.get(readerPreferencesAtom);
    expect(prefs.theme).toBe("plugin:editorial-themes:nocturne");
    expect(prefs.fontSize).toBe("large");
    expect(prefs.lineSpacing).toBe("relaxed");
  });

  test("switching to a built-in keeps the typography the user now has", () => {
    setReaderThemePreference("plugin:editorial-themes:nocturne");
    setReaderThemePreference("warm");
    const prefs = store.get(readerPreferencesAtom);
    expect(prefs.theme).toBe("warm");
    expect(prefs.fontSize).toBe("large");
  });

  test("refuses a value the reader surface does not offer", () => {
    expect(() => setReaderThemePreference("system")).toThrow(/not a reader theme/);
    expect(() => setReaderThemePreference("plugin:editorial-themes:gutenberg")).toThrow(
      /not a reader theme/,
    );
    expect(store.get(readerPreferencesAtom).theme).toBe(DEFAULT_READER_PREFERENCES.theme);
  });
});

describe("readAppearanceState", () => {
  test("reports the stored preferences and what `auto` resolves to", () => {
    setAppThemePreference("dark");
    setReaderThemePreference("auto");
    const state = readAppearanceState();
    expect(state.app.theme).toBe("dark");
    expect(state.reader.theme).toBe("auto");
    // `auto` under a dark app resolves to the dark page color, never to itself.
    expect(state.reader.resolved).toBe(state.app.polarity === "dark" ? "dark" : "warm");
    expect(state.reader.resolved).not.toBe("auto");
  });
});
