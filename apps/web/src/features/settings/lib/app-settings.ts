import { localKV } from "../../../platform/local-store";
import type { DomainActor } from "../../../platform/domain-actor";
import { einkPanelDetected } from "../../../platform/display-profile";
import { isPluginRef } from "../../plugins/lib/plugin-theme";
import { getAppSkinSnapshot } from "./app-skin";

export const APP_SETTINGS_KEY = "read-aware-app-settings";
const STORAGE_KEY = APP_SETTINGS_KEY;

/**
 * App chrome theme. `system` follows the OS color scheme;
 * `plugin:<pluginId>:<themeId>` selects a plugin-contributed skin (its
 * light/dark polarity comes from the theme registry, cached in the app-skin
 * snapshot for boot-time resolution).
 */
export type AppThemePreference = "system" | "light" | "dark" | `plugin:${string}`;
/** Motion preference. `system` honors `prefers-reduced-motion`; `reduced` forces it off. */
export type MotionPreference = "system" | "reduced";
/**
 * E-ink display mode. `auto` follows the device detection
 * (`platform/display-profile`); `on`/`off` are the user's explicit choice.
 * Device-local: it describes this screen, so it never roams (see
 * `roaming-preferences.ts`).
 */
export type EinkPreference = "auto" | "on" | "off";

export type AppSettings = {
  theme: AppThemePreference;
  motion: MotionPreference;
  eink: EinkPreference;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: "system",
  motion: "system",
  eink: "auto",
};

/** Coerce a persisted theme preference to a valid value. */
export function normalizeAppTheme(value: unknown): AppThemePreference {
  if (value === "system" || value === "light" || value === "dark") return value;
  if (isPluginRef(value)) return value;
  return DEFAULT_APP_SETTINGS.theme;
}

function normalizeMotion(value: unknown): MotionPreference {
  return value === "reduced" ? "reduced" : DEFAULT_APP_SETTINGS.motion;
}

function normalizeEink(value: unknown): EinkPreference {
  return value === "on" || value === "off" ? value : DEFAULT_APP_SETTINGS.eink;
}

export function getAppSettings(): AppSettings {
  try {
    const raw = localKV.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      theme: normalizeAppTheme(parsed.theme),
      motion: normalizeMotion(parsed.motion),
      eink: normalizeEink(parsed.eink),
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveAppSettings(settings: AppSettings, origin: DomainActor = "user"): void {
  localKV.setItem(STORAGE_KEY, JSON.stringify(settings), "local", origin);
}

/** Whether e-ink mode is in effect: the explicit choice, else the device detection. */
export function isEinkActive(settings: Pick<AppSettings, "eink"> = getAppSettings()): boolean {
  if (settings.eink === "on") return true;
  if (settings.eink === "off") return false;
  return einkPanelDetected();
}

/**
 * Resolve the app theme to a concrete `light`/`dark`. E-ink mode paints the
 * chrome in its own high-contrast light token set, so it is always `light`.
 * Plugin skins resolve through the persisted snapshot's polarity (the
 * registry is not up yet when this runs at boot); `useAppearance` re-resolves
 * against the live registry once plugins start.
 */
export function resolveAppTheme(settings: Pick<AppSettings, "theme" | "eink">): "light" | "dark" {
  if (isEinkActive(settings)) return "light";
  const preference = settings.theme;
  if (isPluginRef(preference)) {
    const snapshot = getAppSkinSnapshot();
    if (snapshot?.ref === preference) return snapshot.polarity;
    // Dangling ref (skin never applied on this device) — follow the OS.
  } else if (preference !== "system") {
    return preference;
  }
  return systemPrefersDark() ? "dark" : "light";
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function systemPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Whether motion is off, from every source at once: the in-app Motion
 * setting, e-ink mode (a refresh per animation frame is what an e-ink panel
 * cannot afford), then the OS `prefers-reduced-motion` choice.
 */
export function resolveReducedMotion(settings: Pick<AppSettings, "motion" | "eink"> = getAppSettings()): boolean {
  return settings.motion === "reduced" || isEinkActive(settings) || systemPrefersReducedMotion();
}

/**
 * Whether motion should be skipped right now. Imperative motion (deferred
 * unmounts, gesture settles, smooth scrolls, the reader's paging) asks here;
 * CSS reads the same answer from `html[data-motion="reduced"]`, which
 * `applyDisplayAttributes` stamps.
 */
export function prefersReducedMotion(): boolean {
  return resolveReducedMotion();
}

/** The `behavior` for a programmatic scroll: smooth unless motion is off.
 *  An explicit `behavior: "smooth"` overrides the CSS `scroll-behavior` reset,
 *  so scroll calls must ask here. */
export function preferredScrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

/**
 * Stamp the display flags CSS keys off onto the document root:
 * `data-motion="reduced"` (every animation, transition and smooth scroll
 * off — see index.css) and `data-eink` (the e-ink token set and overlay
 * rules). Boot calls this before the first frame; `useAppearance` keeps it
 * live.
 */
export function applyDisplayAttributes(root: HTMLElement, settings: Pick<AppSettings, "motion" | "eink">): void {
  if (resolveReducedMotion(settings)) root.dataset.motion = "reduced";
  else delete root.dataset.motion;
  if (isEinkActive(settings)) root.dataset.eink = "";
  else delete root.dataset.eink;
}
