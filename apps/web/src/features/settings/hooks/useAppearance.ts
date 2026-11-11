import { useEffect, useEffectEvent, useRef } from "react";
import { actorFromEvent, causalActor, type DomainActor } from "../../../platform/domain-actor";
import { useAtomValue, useSetAtom } from "jotai";
import { appSettingsAtom, resolvedAppThemeAtom } from "../../../state/ui";
import { pluginThemesAtom, pluginsReadyAtom } from "../../plugins/state/plugin-store";
import { isPluginRef } from "../../plugins/lib/plugin-theme";
import { useRegisteredContribution } from "../../plugins/hooks/useRegisteredContribution";
import type { RegisteredPluginTheme } from "../../plugins/lib/plugin-types";
import { applyAppSkin, getAppSkinSnapshot, suspendAppSkin } from "../lib/app-skin";
import { applyDisplayAttributes, isEinkActive, REDUCED_MOTION_QUERY } from "../lib/app-settings";

/**
 * Applies the app appearance preferences to the document root and keeps the
 * resolved theme atom current.
 *
 * - Theme: writes `data-theme="light|dark"` and `color-scheme` on <html>, the
 *   hook the dark token overrides and Tailwind `dark:` variant key off. A
 *   plugin skin resolves to its polarity here and additionally stamps
 *   `data-skin` + its token stylesheet (see `applyAppSkin`).
 * - Display: `data-motion="reduced"` whenever motion is off — the Motion
 *   setting, e-ink mode or the OS preference — and `data-eink` in e-ink mode
 *   (see `applyDisplayAttributes`). E-ink mode also pins the chrome to its
 *   light high-contrast token set, so a plugin skin stands down meanwhile.
 *
 * The OS color-scheme media query is subscribed throughout: it decides the
 * `system` preference and the fallback while a selected skin's plugin is
 * missing. Call once near the app root.
 */
export function useAppearance(): void {
  const appSettings = useAtomValue(appSettingsAtom);
  const theme = useRegisteredContribution(
    pluginThemesAtom,
    isPluginRef(appSettings.theme) ? appSettings.theme.slice(7) : "",
  );
  const pluginsReady = useAtomValue(pluginsReadyAtom);
  const setResolvedTheme = useSetAtom(resolvedAppThemeAtom);
  const previous = useRef<
    { preference: string; eink: boolean; theme: typeof theme; ready: boolean; origin: DomainActor } | undefined
  >(undefined);
  // The actor of the settings write that changed the theme; other settings never re-apply it.
  const settingsSource = useEffectEvent(() => actorFromEvent(appSettings));
  const pref = appSettings.theme;
  const eink = isEinkActive(appSettings);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = (origin: DomainActor) => {
      let resolved: "light" | "dark";
      let skin: RegisteredPluginTheme | null = null;
      let bootPending = false;

      if (eink) {
        resolved = "light";
      } else if (isPluginRef(pref)) {
        skin = theme.value?.app ? theme.value : null;
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
      setResolvedTheme(resolved, origin);
      if (eink) suspendAppSkin();
      else applyAppSkin(skin, bootPending, origin);
    };

    const before = previous.current;
    const source =
      before?.preference !== pref || before.eink !== eink
        ? settingsSource()
        : before.theme !== theme
          ? actorFromEvent(theme)
          : before.ready !== pluginsReady
            ? causalActor("system")
            : before.origin;
    previous.current = { preference: pref, eink, theme, ready: pluginsReady, origin: source };
    apply(source);
    const systemChanged = () => apply(causalActor("system"));
    media.addEventListener("change", systemChanged);
    return () => media.removeEventListener("change", systemChanged);
  }, [pref, eink, theme, pluginsReady, setResolvedTheme]);

  const { motion, eink: einkPreference } = appSettings;
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const apply = () => applyDisplayAttributes(root, { motion, eink: einkPreference });
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [motion, einkPreference]);
}
