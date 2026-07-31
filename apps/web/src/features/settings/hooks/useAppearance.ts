import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { appSettingsAtom, resolvedAppThemeAtom } from "../../../state/ui";
import {
  pluginThemesAtom,
  pluginsReadyAtom,
} from "../../plugins/state/plugin-store";
import { isPluginRef, toPluginRef } from "../../plugins/lib/plugin-theme";
import type { RegisteredPluginTheme } from "../../plugins/lib/plugin-types";
import { applyAppSkin, getAppSkinSnapshot } from "../lib/app-skin";

/**
 * Applies the app appearance preferences to the document root and keeps the
 * resolved theme atom current.
 *
 * - Theme: writes `data-theme="light|dark"` and `color-scheme` on <html>, the
 *   hook the dark token overrides and Tailwind `dark:` variant key off. A
 *   plugin skin resolves to its polarity here and additionally stamps
 *   `data-skin` + its token stylesheet (see `applyAppSkin`).
 * - Motion: writes `data-motion="reduced"` when the user forces motion off.
 *
 * The OS color-scheme media query is subscribed throughout: it decides the
 * `system` preference and the fallback while a selected skin's plugin is
 * missing. Call once near the app root.
 */
export function useAppearance(): void {
  const appSettings = useAtomValue(appSettingsAtom);
  const pluginThemes = useAtomValue(pluginThemesAtom);
  const pluginsReady = useAtomValue(pluginsReadyAtom);
  const setResolvedTheme = useSetAtom(resolvedAppThemeAtom);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const pref = appSettings.theme;
      let resolved: "light" | "dark";
      let skin: RegisteredPluginTheme | null = null;
      let bootPending = false;

      if (isPluginRef(pref)) {
        skin =
          pluginThemes.find(
            (theme) => theme.app && toPluginRef(theme.pluginId, theme.id) === pref,
          ) ?? null;
        const snapshot = skin ? null : getAppSkinSnapshot();
        if (skin) {
          resolved = skin.polarity;
        } else if (!pluginsReady && snapshot?.ref === pref) {
          // The plugin has not finished starting; keep the boot-applied skin
          // instead of flashing back to the base theme.
          resolved = snapshot.polarity;
          bootPending = true;
        } else {
          // Plugin gone (uninstalled/disabled) — follow the OS, keep the
          // stored preference so re-enabling the plugin restores the skin.
          resolved = media.matches ? "dark" : "light";
        }
      } else if (pref === "system") {
        resolved = media.matches ? "dark" : "light";
      } else {
        resolved = pref;
      }

      root.dataset.theme = resolved;
      root.style.colorScheme = resolved;
      setResolvedTheme(resolved);
      applyAppSkin(skin, bootPending);
    };

    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appSettings.theme, pluginThemes, pluginsReady, setResolvedTheme]);

  useEffect(() => {
    const root = document.documentElement;
    if (appSettings.motion === "reduced") {
      root.dataset.motion = "reduced";
    } else {
      delete root.dataset.motion;
    }
  }, [appSettings.motion]);
}
