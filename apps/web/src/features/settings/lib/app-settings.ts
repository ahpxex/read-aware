import { localKV } from "../../../platform/local-store";
import { isPluginRef } from "../../plugins/lib/plugin-theme";
import { getAppSkinSnapshot } from "./app-skin";

const STORAGE_KEY = "read-aware-app-settings";

/**
 * App chrome theme. `system` follows the OS color scheme;
 * `plugin:<pluginId>:<themeId>` selects a plugin-contributed skin (its
 * light/dark polarity comes from the theme registry, cached in the app-skin
 * snapshot for boot-time resolution).
 */
export type AppThemePreference = "system" | "light" | "dark" | `plugin:${string}`;
/** Motion preference. `system` honors `prefers-reduced-motion`; `reduced` forces it off. */
export type MotionPreference = "system" | "reduced";

export type AppSettings = {
  theme: AppThemePreference;
  motion: MotionPreference;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: "system",
  motion: "system",
};

/** Coerce a persisted theme preference to a valid value. */
export function normalizeAppTheme(value: unknown): AppThemePreference {
  if (value === "system" || value === "light" || value === "dark") return value;
  if (isPluginRef(value)) return value;
  return DEFAULT_APP_SETTINGS.theme;
}

export function getAppSettings(): AppSettings {
  try {
    const raw = localKV.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      theme: normalizeAppTheme(parsed.theme),
      motion: parsed.motion ?? DEFAULT_APP_SETTINGS.motion,
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveAppSettings(settings: AppSettings): void {
  localKV.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/**
 * Resolve a theme preference to a concrete `light`/`dark`. Plugin skins
 * resolve through the persisted snapshot's polarity (the registry is not up
 * yet when this runs at boot); `useAppearance` re-resolves against the live
 * registry once plugins start.
 */
export function resolveAppTheme(preference: AppThemePreference): "light" | "dark" {
  if (isPluginRef(preference)) {
    const snapshot = getAppSkinSnapshot();
    if (snapshot?.ref === preference) return snapshot.polarity;
    // Dangling ref (skin never applied on this device) — follow the OS.
  } else if (preference !== "system") {
    return preference;
  }
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Whether motion should be skipped right now: the in-app Motion setting wins,
 * otherwise the OS `prefers-reduced-motion` choice. For imperative transition
 * orchestration (deferred unmounts, splash dismissal) that must not rely on
 * CSS alone.
 */
export function prefersReducedMotion(): boolean {
  if (getAppSettings().motion === "reduced") return true;
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
