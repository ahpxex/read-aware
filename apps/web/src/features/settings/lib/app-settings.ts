import { localKV } from "../../../platform/local-store";

const STORAGE_KEY = "read-aware-app-settings";

/** App chrome theme. `system` follows the OS color scheme. */
export type AppThemePreference = "system" | "light" | "dark";
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

export function getAppSettings(): AppSettings {
  try {
    const raw = localKV.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      theme: parsed.theme ?? DEFAULT_APP_SETTINGS.theme,
      motion: parsed.motion ?? DEFAULT_APP_SETTINGS.motion,
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveAppSettings(settings: AppSettings): void {
  localKV.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** Resolve a theme preference to a concrete `light`/`dark` using the OS scheme. */
export function resolveAppTheme(preference: AppThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
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
