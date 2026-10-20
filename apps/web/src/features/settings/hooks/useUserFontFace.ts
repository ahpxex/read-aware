import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { userFontId, type ReaderFontFamily } from "../lib/reader-settings";
import { userFontFaceCss, userFontsAtom } from "../lib/user-fonts";

/**
 * Inject the selected imported font's `@font-face` into the app document so
 * the picker and preview render it — `usePluginFontFace`'s twin for
 * `user:` refs. The rule points at `rablob://…/font/<sha256>`; a font whose
 * bytes have not synced yet simply renders the fallback until they land.
 */
export function useUserFontFace(fontFamily: ReaderFontFamily): void {
  const fonts = useAtomValue(userFontsAtom);
  const id = userFontId(fontFamily);
  const font = id ? fonts.find((entry) => entry.id === id) : undefined;
  useEffect(() => {
    const elementId = font ? `user-font-${font.id}` : id ? `user-font-${id}` : null;
    if (!elementId) return;
    const existing = document.getElementById(elementId) as HTMLStyleElement | null;
    if (!font || !font.bytesLocal) {
      existing?.remove();
      return;
    }
    const style = existing ?? document.createElement("style");
    style.id = elementId;
    if (!existing) document.head.appendChild(style);
    const css = userFontFaceCss(font);
    if (style.textContent !== css) style.textContent = css;
  }, [font, id]);
}
