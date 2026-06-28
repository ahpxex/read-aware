import { useEffect, useState } from "react";
import { curatedFontId, type ReaderFontFamily } from "../lib/reader-settings";
import { injectCuratedFontFace } from "../lib/curated-font-loader";

export type CuratedFontStatus = "idle" | "loading" | "ready" | "error";

/**
 * Loads the active curated font (downloading + caching on first use) and injects
 * its `@font-face` into the app document, so the preview and UI render it. System
 * fonts need no loading, so they stay `idle`. Returns status for a download hint.
 */
export function useCuratedFontFace(fontFamily: ReaderFontFamily): CuratedFontStatus {
  const id = curatedFontId(fontFamily);
  const [status, setStatus] = useState<CuratedFontStatus>("idle");

  useEffect(() => {
    if (!id) {
      setStatus("idle");
      return;
    }
    let active = true;
    setStatus("loading");
    injectCuratedFontFace(id)
      .then(() => active && setStatus("ready"))
      .catch(() => active && setStatus("error"));
    return () => {
      active = false;
    };
  }, [id]);

  return status;
}
