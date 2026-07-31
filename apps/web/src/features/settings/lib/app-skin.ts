/**
 * The app "skin" — a plugin theme applied to the app chrome.
 *
 * Mechanism: the polarity keeps flowing through `data-theme="light|dark"`
 * (so the `dark:` variant, the splash CSS, and the reader's "auto" page color
 * all keep working untouched), while the skin's token overrides ride a second
 * `data-skin="<ref>"` attribute plus one host-generated <style> element.
 *
 * The persisted snapshot exists for boot: plugins activate well after first
 * paint, so `bootAppSkin` (called before React mounts) replays the last
 * generated CSS from the KV, and the Rust shell reads the same snapshot's
 * polarity for its pre-parse `data-theme` stamp. The snapshot is a cache of
 * registry state, never a source of truth — `applyAppSkin` rewrites or clears
 * it on every resolution.
 */
import { localKV } from "../../../platform/local-store";
import { buildAppSkinCss, toPluginRef } from "../../plugins/lib/plugin-theme";
import type { RegisteredPluginTheme } from "../../plugins/lib/plugin-types";

/** Key/shape mirrored by `read_boot_theme` in src-tauri/src/storage/mod.rs. */
const SNAPSHOT_KEY = "read-aware-app-skin";
const STYLE_ID = "ra-app-skin";

export type AppSkinSnapshot = {
  ref: string;
  polarity: "light" | "dark";
  css: string;
};

export function getAppSkinSnapshot(): AppSkinSnapshot | null {
  try {
    const raw = localKV.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AppSkinSnapshot>;
    if (
      typeof parsed.ref !== "string" ||
      (parsed.polarity !== "light" && parsed.polarity !== "dark") ||
      typeof parsed.css !== "string"
    ) {
      return null;
    }
    return { ref: parsed.ref, polarity: parsed.polarity, css: parsed.css };
  } catch {
    return null;
  }
}

function ensureSkinStyle(css: string): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

function removeSkinStyle(): void {
  document.getElementById(STYLE_ID)?.remove();
}

/**
 * Pre-mount replay (main.tsx, right after the polarity stamp): when the
 * stored preference is a plugin theme and the snapshot still matches it,
 * apply the cached CSS so the first React frame is already skinned.
 */
export function bootAppSkin(themePreference: string): void {
  if (!themePreference.startsWith("plugin:")) return;
  const snapshot = getAppSkinSnapshot();
  if (snapshot?.ref !== themePreference) return;
  ensureSkinStyle(snapshot.css);
  document.documentElement.dataset.skin = snapshot.ref;
}

/**
 * Runtime application, called from `useAppearance` on every resolution.
 *
 * - `theme` set: the selected skin is registered — (re)generate its CSS,
 *   stamp the attribute, refresh the snapshot.
 * - `bootPending`: the preference names a skin whose plugin has not finished
 *   starting; leave whatever `bootAppSkin` put up rather than flashing back
 *   to the base theme.
 * - neither: no skin — clear attribute, style, and snapshot.
 */
export function applyAppSkin(
  theme: RegisteredPluginTheme | null,
  bootPending: boolean,
): void {
  if (theme?.app) {
    const ref = toPluginRef(theme.pluginId, theme.id);
    const css = buildAppSkinCss(ref, theme.app);
    ensureSkinStyle(css);
    document.documentElement.dataset.skin = ref;
    const snapshot: AppSkinSnapshot = { ref, polarity: theme.polarity, css };
    localKV.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    return;
  }
  if (bootPending) return;
  delete document.documentElement.dataset.skin;
  removeSkinStyle();
  if (localKV.getItem(SNAPSHOT_KEY) !== null) localKV.removeItem(SNAPSHOT_KEY);
}
