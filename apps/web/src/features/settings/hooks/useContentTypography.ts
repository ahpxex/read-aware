/**
 * Applies the content typography preference to the app document.
 *
 * Mounted once next to `useAppearance` in the root route. It resolves the
 * preference (which may be following the reading settings), makes sure the
 * chosen face is actually loaded into *this* document — curated fonts are
 * downloaded on demand, plugin fonts are served from the plugin folder — and
 * writes the three custom properties the content surfaces read.
 *
 * The font hooks are called unconditionally with a resolved-or-placeholder
 * family: they no-op for a family they don't own, and hooks cannot be called
 * conditionally.
 */
import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { contentTypographyAtom, readerPreferencesAtom } from "../../../state/ui";
import { pluginFontsAtom } from "../../plugins/state/plugin-store";
import { findRegisteredByRef } from "../../plugins/lib/plugin-theme";
import { isPluginFont, type ReaderFontFamily } from "../lib/reader-settings";
import {
  activeContentFont,
  applyContentTypography,
  resolveContentTypography,
} from "../lib/content-typography";
import { useCuratedFontFace } from "./useCuratedFontFace";
import { usePluginFontFace } from "./usePluginFonts";

/** Stands in when content uses the app's own sans — owned by neither loader. */
const NO_FONT = "system:" as ReaderFontFamily;

export function useContentTypography(): void {
  const settings = useAtomValue(contentTypographyAtom);
  const reader = useAtomValue(readerPreferencesAtom);
  const pluginFonts = useAtomValue(pluginFontsAtom);

  const font = activeContentFont(settings, reader);
  useCuratedFontFace(font ?? NO_FONT);
  usePluginFontFace(font ?? NO_FONT);

  const pluginFont =
    font && isPluginFont(font) ? findRegisteredByRef(font, pluginFonts) : null;

  useEffect(() => {
    applyContentTypography(
      document.documentElement,
      resolveContentTypography(settings, reader, pluginFont),
    );
  }, [settings, reader, pluginFont]);
}
