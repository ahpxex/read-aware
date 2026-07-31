/**
 * Reader page-color resolution — the single seam between a stored
 * `ReaderTheme` value and the six-color palette everything renders with.
 *
 * Built-ins live in the table below; a `plugin:<pluginId>:<themeId>` value
 * resolves through the plugin theme registry, falling back to `warm` while
 * its plugin is missing (disabled, still starting, or uninstalled). Every
 * consumer of a palette — the injected book CSS, the workspace background,
 * the completion screen, the settings preview — goes through
 * `resolveReaderPalette`, so plugin themes reach all of them at once.
 */
import { findRegisteredByRef, isPluginRef } from "../../plugins/lib/plugin-theme";
import type { RegisteredPluginTheme } from "../../plugins/lib/plugin-types";
import type {
  BuiltinReaderTheme,
  ReaderFontFamily,
  ReaderSettingsPreferences,
  ReaderTheme,
  ReaderThemePreference,
} from "./reader-settings";

/** The palette a reader theme paints book pages with. */
export type ReaderPalette = {
  bg: string;
  text: string;
  selection: string;
  rule: string;
  faint: string;
  muted: string;
};

export const BUILTIN_READER_PALETTES: Record<BuiltinReaderTheme, ReaderPalette> = {
  light: {
    bg: "#ffffff",
    text: "#1c1917",
    selection: "rgba(168, 162, 158, 0.34)",
    rule: "rgba(28, 25, 23, 0.14)",
    faint: "rgba(28, 25, 23, 0.05)",
    muted: "rgba(28, 25, 23, 0.55)",
  },
  warm: {
    bg: "#f5f1e8",
    text: "#292524",
    selection: "rgba(168, 162, 158, 0.34)",
    rule: "rgba(41, 37, 36, 0.16)",
    faint: "rgba(41, 37, 36, 0.05)",
    muted: "rgba(41, 37, 36, 0.55)",
  },
  dark: {
    bg: "#1c1917",
    text: "#d6d3d1",
    selection: "rgba(168, 162, 158, 0.28)",
    rule: "rgba(214, 211, 209, 0.2)",
    faint: "rgba(214, 211, 209, 0.07)",
    muted: "rgba(214, 211, 209, 0.55)",
  },
};

/** The registered plugin theme behind a reader theme value, if any. */
export function findPluginReaderTheme(
  theme: ReaderTheme | ReaderThemePreference,
  pluginThemes: readonly RegisteredPluginTheme[],
): RegisteredPluginTheme | null {
  if (!isPluginRef(theme)) return null;
  const entry = findRegisteredByRef(theme, pluginThemes);
  return entry?.reader ? entry : null;
}

/** Resolve a concrete reader theme to its palette (warm fallback for danglers). */
export function resolveReaderPalette(
  theme: ReaderTheme,
  pluginThemes: readonly RegisteredPluginTheme[],
): ReaderPalette {
  if (isPluginRef(theme)) {
    return (
      findPluginReaderTheme(theme, pluginThemes)?.reader?.palette ??
      BUILTIN_READER_PALETTES.warm
    );
  }
  return BUILTIN_READER_PALETTES[theme];
}

/**
 * Selecting a page color in either appearance surface goes through here.
 * Built-ins just switch the theme; a plugin theme additionally applies its
 * declared typography as a one-shot preset — seeding the ordinary settings,
 * which stay freely editable afterwards (re-selecting re-applies).
 */
export function applyReaderThemeSelection(
  prefs: ReaderSettingsPreferences,
  theme: ReaderThemePreference,
  pluginThemes: readonly RegisteredPluginTheme[],
): ReaderSettingsPreferences {
  const next: ReaderSettingsPreferences = { ...prefs, theme };
  const typography = findPluginReaderTheme(theme, pluginThemes)?.reader?.typography;
  if (!typography) return next;
  if (typography.fontFamily) next.fontFamily = typography.fontFamily as ReaderFontFamily;
  if (typography.fontSize) next.fontSize = typography.fontSize;
  if (typography.fontWeight) next.fontWeight = typography.fontWeight;
  if (typography.lineSpacing) next.lineSpacing = typography.lineSpacing;
  if (typography.paragraphSpacing) next.paragraphSpacing = typography.paragraphSpacing;
  return next;
}
