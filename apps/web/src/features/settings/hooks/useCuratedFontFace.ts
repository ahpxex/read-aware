import { useCallback, useEffect, useState } from "react";
import {
  curatedFontId,
  type ReaderFontFamily,
  type ReaderFontWeight,
} from "../lib/reader-settings";
import { readerFontWeightsNeeded } from "../lib/reader-css";
import {
  getCuratedFontProgress,
  injectCuratedFontFace,
  subscribeCuratedFontProgress,
} from "../lib/curated-font-loader";

export type CuratedFontStatus = "idle" | "loading" | "ready" | "error";

export interface CuratedFontFaceState {
  status: CuratedFontStatus;
  /** 下载进度 0..1（分片计数）；非 loading 状态下无意义。 */
  progress: number;
  /** 失败后手动重试（加载器不缓存失败,重试即重新下载）。 */
  retry: () => void;
}

/**
 * Loads the active curated font (downloading + caching on first use) and injects
 * its `@font-face` into the app document, so the preview and UI render it.
 * `fontWeight` decides which numeric weights get fetched — the same set the
 * reader itself needs, so the preview download is also the reader's download.
 * System fonts need no loading, so they stay `idle`. Exposes download progress
 * and a retry for the failure case (e.g. the font CDN is unreachable).
 */
export function useCuratedFontFace(
  fontFamily: ReaderFontFamily,
  fontWeight: ReaderFontWeight = "regular",
): CuratedFontFaceState {
  const id = curatedFontId(fontFamily);
  // Serialized so the effect keys on the set's value, not array identity.
  const weightsKey = readerFontWeightsNeeded(fontWeight).join(",");
  const [status, setStatus] = useState<CuratedFontStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id) {
      setStatus("idle");
      return;
    }
    let active = true;
    setStatus("loading");
    const initial = getCuratedFontProgress(id);
    setProgress(initial && initial.total > 0 ? initial.done / initial.total : 0);
    const unsubscribe = subscribeCuratedFontProgress(id, ({ done, total }) => {
      if (active && total > 0) setProgress(done / total);
    });
    injectCuratedFontFace(id, weightsKey.split(",").map(Number))
      .then(() => active && setStatus("ready"))
      .catch(() => active && setStatus("error"));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [id, weightsKey, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { status, progress, retry };
}
