/**
 * Storybook's display toolbar (theme, e-ink, motion), applied the way the app
 * boots (`main.tsx`): the document gets the same `data-theme` / `data-eink` /
 * `data-motion` stamps, and the app-settings atom holds the same preference,
 * so CSS and the React output that reads `useDisplayMode` agree. Stamping the
 * attributes alone would give a half e-ink state the product never shows.
 *
 * Every store a story renders against must carry the seed — the preview's
 * default store and each `withAtoms` store alike — which is why both build
 * from `storyDisplaySeed`.
 *
 * This is story-only support code; nothing in the product imports it.
 */
import { appSettingsAtom } from "../state/ui";
import {
  applyDisplayAttributes,
  resolveAppTheme,
  type AppSettings,
  type EinkPreference,
  type MotionPreference,
} from "../features/settings/lib/app-settings";
import type { AtomSeed } from "./atoms";

/** Storybook's toolbar globals (`context.globals`). */
export type StoryGlobals = Record<string, unknown>;

/** The app settings the toolbar globals stand for. */
export function storyAppSettings(globals: StoryGlobals): AppSettings {
  const theme = globals.theme === "dark" ? "dark" : "light";
  // `off`, not `auto`: a browser preview has no e-paper panel to detect, and
  // the toolbar's "Off" should mean off on every host.
  const eink: EinkPreference = globals.eink === "on" ? "on" : "off";
  // `system` keeps honoring the OS reduce-motion preference, as the app does.
  const motion: MotionPreference = globals.motion === "reduced" ? "reduced" : "system";
  return { theme, motion, eink };
}

/** Seeds `appSettingsAtom` with the toolbar's display settings. */
export function storyDisplaySeed(globals: StoryGlobals): AtomSeed {
  // Spelled out rather than `seed(...)` so this module does not import back
  // into `atoms.tsx`, which builds every story store from it.
  const settings = storyAppSettings(globals);
  return (apply) => apply(appSettingsAtom, settings);
}

/** Stamps the document as the app's boot does for the same settings. */
export function applyStoryDisplay(globals: StoryGlobals): void {
  if (typeof document === "undefined") return;
  const settings = storyAppSettings(globals);
  const root = document.documentElement;
  // E-ink pins the chrome to its light token set (see `resolveAppTheme`).
  const theme = resolveAppTheme(settings);
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  applyDisplayAttributes(root, settings);
}

/** A key that changes whenever the display globals do, to remount the store. */
export function storyDisplayKey(globals: StoryGlobals): string {
  const { theme, eink, motion } = storyAppSettings(globals);
  return `${theme}|${eink}|${motion}`;
}
