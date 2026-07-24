/**
 * Reader typography: the responsive text measure and the injected stylesheet.
 *
 * Extracted from FoliateReaderView, which had accumulated every reader concern
 * in one component. This cluster is self-contained — it reads the live layout
 * and the current settings, and writes to the foliate renderer — so it belongs
 * in a hook rather than among the engine, selection, and annotation effects.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  buildReaderContentCss,
  computeReaderMaxInlineSize,
  readerFontWeightsNeeded,
  readerGapForMargins,
} from "../../settings/lib/reader-css";
import { curatedFontId } from "../../settings/lib/reader-settings";
import type { ReaderSettings, ReadingMode } from "../../settings/lib/reader-settings";
import { ensureCuratedFontFaceCss } from "../../settings/lib/curated-font-loader";
import type { FoliateRenderer, FoliateView } from "../lib/foliate-engine";

type Options = {
  readerSettings: ReaderSettings;
  viewRef: RefObject<FoliateView | null>;
  readerRootRef: RefObject<HTMLElement | null>;
  viewportRef: RefObject<HTMLElement | null>;
  /** Fixed-layout books (PDF/CBZ) size themselves; the measure must not apply. */
  isFixedLayoutRef: RefObject<boolean>;
  readingModeRef: RefObject<ReadingMode>;
  layoutForReadingMode: (mode: ReadingMode) => { maxColumnCount: number };
};

export type ReaderTypography = {
  /** Latest settings, for callers that apply them outside React's flow. */
  settingsRef: RefObject<ReaderSettings>;
  /** Recompute and push the text measure onto the renderer. */
  applyMaxInlineSize: () => void;
  /** Rebuild and inject the reader stylesheet (loading webfonts first). */
  injectStyles: (settings: ReaderSettings, renderer?: FoliateRenderer) => Promise<void>;
};

export function useReaderTypography({
  readerSettings,
  viewRef,
  readerRootRef,
  viewportRef,
  isFixedLayoutRef,
  readingModeRef,
  layoutForReadingMode,
}: Options): ReaderTypography {
  const settingsRef = useRef(readerSettings);

  /**
   * Drive the responsive text measure through foliate's `max-inline-size`
   * attribute. The paginator caps the column to that value (px) and writes it
   * onto the body with inline `!important`, so a width set via injected CSS is
   * ignored — the attribute is the only lever, and it must be recomputed from
   * the live reader width (it cannot use vw).
   */
  const applyMaxInlineSize = useCallback(() => {
    const renderer = viewRef.current?.renderer;
    if (!renderer || isFixedLayoutRef.current) return;
    const width =
      readerRootRef.current?.clientWidth ??
      viewportRef.current?.clientWidth ??
      window.innerWidth;
    const height =
      readerRootRef.current?.clientHeight ??
      viewportRef.current?.clientHeight ??
      window.innerHeight;
    const { maxColumnCount } = layoutForReadingMode(readingModeRef.current);
    // foliate renders a single column in portrait containers regardless of
    // max-column-count, so size the measure for the columns that will
    // actually show — halving it in portrait would just shrink the one column.
    const effectiveColumns = width > height ? maxColumnCount : 1;
    const margins = settingsRef.current.pageMargins;
    const px = computeReaderMaxInlineSize(width, margins, effectiveColumns);
    renderer.setAttribute("max-inline-size", `${px}px`);
    renderer.setAttribute("gap", readerGapForMargins(margins));
  }, [
    isFixedLayoutRef,
    layoutForReadingMode,
    readerRootRef,
    readingModeRef,
    viewRef,
    viewportRef,
  ]);

  /**
   * Inject the reader stylesheet, first ensuring the active curated webfont is
   * downloaded so its @font-face (with on-demand blob URLs) ships in the same
   * CSS. System/preset fonts need no @font-face, so they apply immediately.
   */
  const injectStyles = useCallback(
    async (settings: ReaderSettings, renderer = viewRef.current?.renderer) => {
      const id = curatedFontId(settings.fontFamily);
      const fontFaceCss = id
        ? await ensureCuratedFontFaceCss(id, readerFontWeightsNeeded(settings.fontWeight)).catch(
            () => "",
          )
        : "";
      renderer?.setStyles?.(buildReaderContentCss(settings, fontFaceCss));
    },
    [viewRef],
  );

  // Settings change -> re-inject reader CSS and refresh the text measure.
  useEffect(() => {
    settingsRef.current = readerSettings;
    void injectStyles(readerSettings);
    applyMaxInlineSize();
  }, [readerSettings, applyMaxInlineSize, injectStyles]);

  return { settingsRef, applyMaxInlineSize, injectStyles };
}
