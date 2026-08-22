/**
 * Programmatic appearance control — the one seam through which something
 * other than a person clicking a control changes what the app looks like.
 *
 * Two callers share it: the reading agent's settings catalog (which needs the
 * VOCABULARY — which theme values exist and what polarity each has) and the
 * `ui:appearance` plugin capability (which needs the whole thing: list, read,
 * write). Both write through the same preferences the panels write, so a
 * programmatic change is indistinguishable from a hand-made one — including
 * the typography preset a plugin reader theme applies when it is selected.
 *
 * What this module deliberately does NOT touch: per-book appearance
 * overrides. A book the user pinned to its own page color keeps it; the
 * global preference is what changes here, exactly as it would from Settings.
 */
import { getDefaultStore } from "jotai";
import { i18n } from "../../../i18n";
import { contributionText } from "../../plugins/lib/plugin-i18n";
import { toPluginRef } from "../../plugins/lib/plugin-theme";
import type { RegisteredPluginTheme } from "../../plugins/lib/plugin-types";
import { pluginThemesAtom } from "../../plugins/state/plugin-store";
import {
  appSettingsAtom,
  readerPreferencesAtom,
  resolvedAppThemeAtom,
} from "../../../state/ui";
import type { AppThemePreference } from "./app-settings";
import { resolveReaderTheme, type ReaderThemePreference } from "./reader-settings";
import { applyReaderThemeSelection } from "./reader-theme";

export type AppearanceSurface = "app" | "reader";
export type ThemePolarity = "light" | "dark";

/**
 * The built-in appearance values, in the order pickers list them, each with
 * the surfaces it belongs to and the polarity it commits to. `system` and
 * `auto` commit to none — they answer to something else (the OS, the app
 * theme), which is why they are the only null entries.
 *
 * This table is the vocabulary itself: the agent catalog and the plugin
 * capability both build their option lists from it rather than each keeping
 * a copy that can drift from the other.
 */
export const BUILTIN_APPEARANCE_THEMES: readonly {
  value: string;
  surfaces: AppearanceSurface[];
  polarity: ThemePolarity | null;
}[] = [
  { value: "system", surfaces: ["app"], polarity: null },
  { value: "auto", surfaces: ["reader"], polarity: null },
  { value: "light", surfaces: ["app", "reader"], polarity: "light" },
  { value: "warm", surfaces: ["reader"], polarity: "light" },
  { value: "dark", surfaces: ["app", "reader"], polarity: "dark" },
];

/** The built-ins of one surface, in picker order. */
export function builtinThemesFor(surface: AppearanceSurface): {
  value: string;
  polarity: ThemePolarity | null;
}[] {
  return BUILTIN_APPEARANCE_THEMES.filter((theme) =>
    theme.surfaces.includes(surface),
  ).map(({ value, polarity }) => ({ value, polarity }));
}

/** One selectable appearance value, as a picker would list it. */
export type AppearanceThemeOption = {
  value: string;
  label: string;
  polarity: ThemePolarity | null;
  surfaces: AppearanceSurface[];
  pluginId?: string;
  pluginName?: string;
};

export type AppearanceState = {
  app: { theme: AppThemePreference; polarity: ThemePolarity };
  reader: {
    theme: ReaderThemePreference;
    resolved: Exclude<ReaderThemePreference, "auto">;
  };
};

/** The surfaces a registered plugin theme offers — it may skin only one. */
function themeSurfaces(theme: RegisteredPluginTheme): AppearanceSurface[] {
  const surfaces: AppearanceSurface[] = [];
  if (theme.app) surfaces.push("app");
  if (theme.reader) surfaces.push("reader");
  return surfaces;
}

/** The app's own label for a built-in value, in the current UI language. */
function builtinLabel(surface: AppearanceSurface, value: string): string {
  return surface === "app"
    ? i18n.t(`settings:appearance.themeOptions.${value}`, { defaultValue: value })
    : i18n.t(`reader:pageColorOption.${value}`, { defaultValue: value });
}

/**
 * Every value both pickers offer, in one list: the built-ins carry the
 * surfaces they belong to, a plugin theme the surfaces it declares.
 */
export function listAppearanceThemes(
  pluginThemes: readonly RegisteredPluginTheme[] = getDefaultStore().get(pluginThemesAtom),
): AppearanceThemeOption[] {
  const options: AppearanceThemeOption[] = BUILTIN_APPEARANCE_THEMES.map((theme) => ({
    value: theme.value,
    // A value on both surfaces is named by the app's own control; the
    // reader-only page colors are named by the reader's.
    label: builtinLabel(theme.surfaces[0], theme.value),
    polarity: theme.polarity,
    surfaces: [...theme.surfaces],
  }));
  for (const theme of pluginThemes) {
    const surfaces = themeSurfaces(theme);
    if (surfaces.length === 0) continue;
    options.push({
      value: toPluginRef(theme.pluginId, theme.id),
      label: contributionText(theme.name),
      polarity: theme.polarity,
      surfaces,
      pluginId: theme.pluginId,
      pluginName: theme.pluginName,
    });
  }
  return options;
}

export function readAppearanceState(): AppearanceState {
  const store = getDefaultStore();
  const polarity = store.get(resolvedAppThemeAtom);
  const reader = store.get(readerPreferencesAtom).theme;
  return {
    app: { theme: store.get(appSettingsAtom).theme, polarity },
    reader: { theme: reader, resolved: resolveReaderTheme(reader, polarity) },
  };
}

/**
 * Accept a value only if the surface currently offers it. A dangling ref is
 * legitimate as STORED state (its plugin may be temporarily disabled), but
 * never as an incoming write: the caller just listed the options, and quietly
 * storing a ref that resolves to nothing would show as the fallback palette
 * with no explanation.
 */
function requireOption(
  surface: AppearanceSurface,
  value: unknown,
  pluginThemes: readonly RegisteredPluginTheme[],
): string {
  const offered = listAppearanceThemes(pluginThemes).filter((option) =>
    option.surfaces.includes(surface),
  );
  const match = typeof value === "string" && offered.some((option) => option.value === value);
  if (!match) {
    throw new Error(
      `"${String(value)}" is not ${surface === "app" ? "an app" : "a reader"} theme; expected one of: ${offered
        .map((option) => option.value)
        .join(", ")}`,
    );
  }
  return value as string;
}

export function setAppThemePreference(value: unknown): void {
  const store = getDefaultStore();
  const theme = requireOption("app", value, store.get(pluginThemesAtom)) as AppThemePreference;
  const settings = store.get(appSettingsAtom);
  if (settings.theme === theme) return;
  store.set(appSettingsAtom, { ...settings, theme });
}

export function setReaderThemePreference(value: unknown): void {
  const store = getDefaultStore();
  const pluginThemes = store.get(pluginThemesAtom);
  const theme = requireOption("reader", value, pluginThemes) as ReaderThemePreference;
  const prefs = store.get(readerPreferencesAtom);
  // Not short-circuited on equality: re-selecting a plugin theme re-applies
  // its typography preset, which is what selecting it by hand does too.
  store.set(readerPreferencesAtom, applyReaderThemeSelection(prefs, theme, pluginThemes));
}
