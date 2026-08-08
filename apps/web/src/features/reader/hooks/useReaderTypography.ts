/**
 * Reader appearance: the responsive text measure, the injected stylesheet, and
 * the page colors a fixed-layout book is drawn with.
 *
 * Extracted from FoliateReaderView, which had accumulated every reader concern
 * in one component. This cluster is self-contained — it reads the live layout
 * and the current settings, and writes to the foliate renderer — so it belongs
 * in a hook rather than among the engine, selection, and annotation effects.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useAtomValue } from "jotai";
import {
  buildReaderContentCss,
  computeReaderMaxInlineSize,
  readerFontWeightsNeeded,
  readerGapForMargins,
} from "../../settings/lib/reader-css";
import { curatedFontId, isPluginFont } from "../../settings/lib/reader-settings";
import type { ReaderSettings, ReadingMode } from "../../settings/lib/reader-settings";
import { ensureCuratedFontFaceCss } from "../../settings/lib/curated-font-loader";
import { resolveReaderPalette } from "../../settings/lib/reader-theme";
import { pluginFontFaceCss } from "../../settings/hooks/usePluginFonts";
import { findRegisteredByRef } from "../../plugins/lib/plugin-theme";
import {
  pluginFontsAtom,
  pluginThemesAtom,
} from "../../plugins/state/plugin-store";
import { fixedLayoutPageColors } from "../lib/fixed-layout-colors";
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
  /**
   * Push the palette onto a fixed-layout renderer, which draws it into the
   * page. No-op for reflowable books — they take the palette as CSS instead.
   */
  applyPageColors: (settings: ReaderSettings, renderer?: FoliateRenderer) => void;
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

  // Plugin contributions feed the injected CSS two ways: the palette behind a
  // plugin page color, and the @font-face + family stack behind a plugin
  // font. Subscribing here re-injects when a plugin (de)activates mid-read.
  const pluginThemes = useAtomValue(pluginThemesAtom);
  const pluginFonts = useAtomValue(pluginFontsAtom);

  /**
   * Inject the reader stylesheet, first ensuring the active curated webfont is
   * downloaded so its @font-face (with on-demand blob URLs) ships in the same
   * CSS. Plugin fonts need no download — their faces point at the plugin
   * folder; system fonts need no @font-face at all.
   */
  const injectStyles = useCallback(
    async (settings: ReaderSettings, renderer = viewRef.current?.renderer) => {
      const id = curatedFontId(settings.fontFamily);
      const pluginFont = isPluginFont(settings.fontFamily)
        ? findRegisteredByRef(settings.fontFamily, pluginFonts)
        : null;
      const fontFaceCss = id
        ? await ensureCuratedFontFaceCss(id, readerFontWeightsNeeded(settings.fontWeight)).catch(
            () => "",
          )
        : pluginFont
          ? pluginFontFaceCss(pluginFont)
          : "";
      const palette = resolveReaderPalette(settings.theme, pluginThemes);
      renderer?.setStyles?.(
        buildReaderContentCss(settings, { palette, fontFaceCss, pluginFont }),
      );
    },
    [viewRef, pluginFonts, pluginThemes],
  );

  const applyPageColors = useCallback(
    (settings: ReaderSettings, renderer = viewRef.current?.renderer) => {
      if (!renderer?.setPageColors) return;
      renderer.setPageColors(
        fixedLayoutPageColors(
          resolveReaderPalette(settings.theme, pluginThemes),
          settings.fixedLayoutColor,
        ),
      );
    },
    [viewRef, pluginThemes],
  );

  // Settings change -> re-inject reader CSS, refresh the text measure, and
  // redraw a fixed-layout book in the new palette.
  useEffect(() => {
    settingsRef.current = readerSettings;
    void injectStyles(readerSettings);
    applyMaxInlineSize();
    applyPageColors(readerSettings);
  }, [readerSettings, applyMaxInlineSize, injectStyles, applyPageColors]);

  return { settingsRef, applyMaxInlineSize, injectStyles, applyPageColors };
}
