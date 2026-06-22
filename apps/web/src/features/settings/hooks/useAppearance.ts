import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { appSettingsAtom, resolvedAppThemeAtom } from "../../../state/ui";

/**
 * Applies the app appearance preferences to the document root and keeps the
 * resolved theme atom current.
 *
 * - Theme: writes `data-theme="light|dark"` and `color-scheme` on <html>, the
 *   hook the dark token overrides and Tailwind `dark:` variant key off.
 * - Motion: writes `data-motion="reduced"` when the user forces motion off.
 *
 * For `system` theme it subscribes to the OS color-scheme media query so the
 * app tracks OS light/dark changes live. Call once near the app root.
 */
export function useAppearance(): void {
  const appSettings = useAtomValue(appSettingsAtom);
  const setResolvedTheme = useSetAtom(resolvedAppThemeAtom);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const resolved =
        appSettings.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : appSettings.theme;
      root.dataset.theme = resolved;
      root.style.colorScheme = resolved;
      setResolvedTheme(resolved);
    };

    apply();

    if (appSettings.theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appSettings.theme, setResolvedTheme]);

  useEffect(() => {
    const root = document.documentElement;
    if (appSettings.motion === "reduced") {
      root.dataset.motion = "reduced";
    } else {
      delete root.dataset.motion;
    }
  }, [appSettings.motion]);
}
