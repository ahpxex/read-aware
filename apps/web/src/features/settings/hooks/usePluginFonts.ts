import { useEffect, useMemo } from "react";
import { useAtomValue } from "jotai";
import { pluginFontsAtom } from "../../plugins/state/plugin-store";
import {
  buildPluginFontFaceCss,
  findRegisteredByRef,
} from "../../plugins/lib/plugin-theme";
import type { RegisteredPluginFont } from "../../plugins/lib/plugin-types";
import { pluginAssetUrl } from "../../plugins/runtime/plugin-backend";
import { isPluginFont, type ReaderFontFamily } from "../lib/reader-settings";

/** The registered contribution behind a `plugin:` font selection, or null. */
export function useRegisteredPluginFont(
  fontFamily: ReaderFontFamily,
): RegisteredPluginFont | null {
  const fonts = useAtomValue(pluginFontsAtom);
  return useMemo(
    () => (isPluginFont(fontFamily) ? findRegisteredByRef(fontFamily, fonts) : null),
    [fontFamily, fonts],
  );
}

/** `@font-face` rules for a registered plugin font (folder-served URLs). */
export function pluginFontFaceCss(font: RegisteredPluginFont): string {
  return buildPluginFontFaceCss(font, (path) => pluginAssetUrl(font.pluginId, path));
}

/**
 * Inject a plugin font's `@font-face` into the app document so the picker and
 * the reading preview render it — the counterpart of `injectCuratedFontFace`
 * for plugin-bundled fonts. Injection is idempotent and the element stays
 * (like curated faces); the rules point at the plugin folder, so there is no
 * download to track.
 */
export function usePluginFontFace(fontFamily: ReaderFontFamily): void {
  const font = useRegisteredPluginFont(fontFamily);
  useEffect(() => {
    if (!font) return;
    const elementId = `plugin-font-${font.pluginId}-${font.id}`;
    let style = document.getElementById(elementId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = elementId;
      document.head.appendChild(style);
    }
    const css = pluginFontFaceCss(font);
    if (style.textContent !== css) style.textContent = css;
  }, [font]);
}
