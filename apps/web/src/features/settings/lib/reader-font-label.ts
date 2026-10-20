import { findRegisteredByRef, parsePluginRef } from "../../plugins/lib/plugin-theme";
import type { RegisteredPluginFont } from "../../plugins/lib/plugin-types";
import { getCuratedFont } from "./curated-font-catalog";
import { curatedFontId, isPluginFont, systemFontFamily, userFontId, type ReaderFontFamily } from "./reader-settings";
import type { UserFontEntry } from "../../../domain/fonts";

/**
 * The name to show for a reader font selection, where a surface names the
 * current font without listing the choices (FontField owns the list): a
 * curated font's label, an installed family's own name, a plugin font's
 * family, an imported font's parsed family name, or, while its plugin is
 * gone, the id it was stored under.
 */
export function readerFontLabel(
  font: ReaderFontFamily,
  pluginFonts: readonly RegisteredPluginFont[],
  userFonts: readonly UserFontEntry[] = [],
): string {
  const curated = curatedFontId(font);
  if (curated !== null) return getCuratedFont(curated)?.label ?? curated;
  const system = systemFontFamily(font);
  if (system !== null) return system;
  if (isPluginFont(font)) {
    return findRegisteredByRef(font, pluginFonts)?.family ?? parsePluginRef(font)?.partId ?? font;
  }
  const imported = userFontId(font);
  if (imported !== null) {
    // A dangling ref (removed font) is swept back to default on the next
    // registry read; until then naming the ref itself is honest.
    return userFonts.find((entry) => entry.id === imported)?.name ?? font;
  }
  return font;
}
