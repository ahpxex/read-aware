import { useEffect, useState } from "react";
import { listSystemFonts } from "../lib/system-fonts";

/**
 * The installed font families, loaded once for the reader font picker. Empty
 * until the async enumeration resolves (and stays empty off the desktop shell),
 * so callers should treat it as "presets plus whatever this returns".
 */
export function useSystemFonts(): string[] {
  const [fonts, setFonts] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    listSystemFonts().then((list) => {
      if (active) setFonts(list);
    });
    return () => {
      active = false;
    };
  }, []);

  return fonts;
}
