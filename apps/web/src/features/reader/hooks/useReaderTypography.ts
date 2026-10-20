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
import { getDefaultStore, useAtomValue } from "jotai";
import {
  buildReaderContentCss,
  computeReaderMaxInlineSize,
  readerFontWeightsNeeded,
  readerLayoutSpacing,
} from "../../settings/lib/reader-css";
import { curatedFontId, isPluginFont, userFontId } from "../../settings/lib/reader-settings";
import type { ReaderSettings, ReadingMode } from "../../settings/lib/reader-settings";
import { ensureCuratedFontFaceCss, localCuratedFontFaceCss } from "../../settings/lib/curated-font-loader";
import { findUserFont, userFontFaceCss, userFontsAtom } from "../../settings";
import { resolveReaderPalette } from "../../settings/lib/reader-theme";
import { pluginFontFaceCss } from "../../settings/hooks/usePluginFonts";
import { findRegisteredByRef, isPluginRef } from "../../plugins/lib/plugin-theme";
import { useRegisteredContribution } from "../../plugins/hooks/useRegisteredContribution";
import { pluginFontsAtom, pluginThemesAtom } from "../../plugins/state/plugin-store";
import { fixedLayoutPageColors } from "../lib/fixed-layout-colors";
import type { FoliateRenderer, FoliateView } from "../lib/foliate-engine";
import {
  actorFromEvent,
  eventCause,
  mergeEventCauses,
  stampEventCause,
  type DomainActor,
} from "../../../platform/domain-actor";
import { readingRenderContext } from "../lib/reading-render-context";
import { normalizeReaderTextSizes } from "../lib/reader-document-layout";
import { createLogger } from "../../../platform/logger";

const log = createLogger("reader-typography");

/** One stylesheet request per renderer; `styled` settles once the renderer
 * carries this request's stylesheet or a newer request's. */
type StyleRequest = { styled: Promise<void> };

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
  applyMaxInlineSize: (origin?: DomainActor) => void;
  /**
   * Rebuild and inject the reader stylesheet. Resolves once the renderer is
   * styled — by this request or one that replaced it. A curated font already
   * on this device ships in that stylesheet; one that must download is
   * swapped in afterwards, the book reading in the fallback stack meanwhile.
   */
  injectStyles: (settings: ReaderSettings, renderer?: FoliateRenderer, origin?: DomainActor) => Promise<void>;
  /**
   * Start reading `settings`' curated font from this device, so a following
   * `injectStyles` doesn't wait on the cache read.
   */
  prepareStyles: (settings: ReaderSettings) => void;
  /**
   * Push the palette onto a fixed-layout renderer, which draws it into the
   * page. No-op for reflowable books — they take the palette as CSS instead.
   */
  applyPageColors: (settings: ReaderSettings, renderer?: FoliateRenderer, origin?: DomainActor) => void;
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
  const styleRequests = useRef(new WeakMap<FoliateRenderer, StyleRequest>());
  const needsStyles = useRef(true);
  useEffect(
    () => () => {
      styleRequests.current = new WeakMap();
      needsStyles.current = true;
    },
    [],
  );

  /**
   * Drive the responsive text measure through foliate's `max-inline-size`
   * attribute. The paginator caps the column to that value (px) and writes it
   * onto the body with inline `!important`, so a width set via injected CSS is
   * ignored — the attribute is the only lever, and it must be recomputed from
   * the live reader width (it cannot use vw).
   */
  const applyMaxInlineSize = useCallback(
    (origin: DomainActor = "system") => {
      const renderer = viewRef.current?.renderer;
      if (!renderer || isFixedLayoutRef.current) return;
      const width = readerRootRef.current?.clientWidth ?? viewportRef.current?.clientWidth ?? window.innerWidth;
      const height = readerRootRef.current?.clientHeight ?? viewportRef.current?.clientHeight ?? window.innerHeight;
      const { maxColumnCount } = layoutForReadingMode(readingModeRef.current);
      // foliate renders a single column in portrait containers regardless of
      // max-column-count, so size the measure for the columns that will
      // actually show — halving it in portrait would just shrink the one column.
      const effectiveColumns = width > height ? maxColumnCount : 1;
      const margins = settingsRef.current.pageMargins;
      const { gap, margin } = readerLayoutSpacing(margins, readingModeRef.current);
      const px = computeReaderMaxInlineSize(width, margins, effectiveColumns);
      if ("setLayoutAttributes" in renderer)
        renderer.setLayoutAttributes(
          {
            "max-inline-size": `${px}px`,
            gap,
            margin,
          },
          readingRenderContext(origin),
        );
    },
    [isFixedLayoutRef, layoutForReadingMode, readerRootRef, readingModeRef, viewRef, viewportRef],
  );

  // Plugin contributions feed the injected CSS two ways: the palette behind a
  // plugin page color, and the @font-face + family stack behind a plugin
  // font. Subscribing here re-injects when a plugin (de)activates mid-read.
  const pluginThemes = useAtomValue(pluginThemesAtom);
  const pluginFonts = useAtomValue(pluginFontsAtom);
  const userFonts = useAtomValue(userFontsAtom);
  const font = useRegisteredContribution(
    pluginFontsAtom,
    isPluginFont(readerSettings.fontFamily) ? readerSettings.fontFamily.slice(7) : "",
  );
  const theme = useRegisteredContribution(
    pluginThemesAtom,
    isPluginRef(readerSettings.theme) ? readerSettings.theme.slice(7) : "",
  );
  // The registry row behind a `user:` selection — its `bytesLocal` flip is
  // what re-injects once the synced font file lands on this device.
  const userFont = findUserFont(readerSettings.fontFamily, userFonts);
  const previousInputs = useRef<
    | {
        settings: ReaderSettings;
        font: typeof font;
        theme: typeof theme;
        userFont: typeof userFont;
        origin: DomainActor;
      }
    | undefined
  >(undefined);

  /**
   * Inject the reader stylesheet. The active curated webfont's @font-face
   * (with on-demand blob URLs) ships in the same CSS when its faces are on
   * this device; otherwise the book is styled in the fallback stack at once
   * and restyled when the download lands — the page never waits on the
   * network, and never shows unstyled. Plugin fonts need no download — their
   * faces point at the plugin folder; system fonts need no @font-face at all.
   */
  const injectStyles = useCallback(
    (settings: ReaderSettings, renderer = viewRef.current?.renderer, origin?: DomainActor): Promise<void> => {
      if (!renderer || !("setStyles" in renderer)) return Promise.resolve();
      const requests = styleRequests.current,
        styled = Promise.withResolvers<void>(),
        request: StyleRequest = { styled: styled.promise },
        context = readingRenderContext(origin ?? (eventCause(settings) ? actorFromEvent(settings) : "system"));
      requests.set(renderer, request);
      // Whether this request still owns the renderer's stylesheet. A request
      // that lost it hands its waiters to the one that replaced it; a retired
      // renderer or reader has nothing left to wait for.
      const owns = () => {
        if (requests !== styleRequests.current || viewRef.current?.renderer !== renderer) {
          styled.resolve();
          return false;
        }
        const latest = requests.get(renderer);
        if (latest === request) return true;
        styled.resolve(latest?.styled);
        return false;
      };
      const pluginFont = isPluginFont(settings.fontFamily)
        ? findRegisteredByRef(settings.fontFamily, pluginFonts)
        : null;
      const palette = resolveReaderPalette(settings.theme, pluginThemes);
      const apply = (fontFaceCss: string) => {
        renderer.setStyles(buildReaderContentCss(settings, { palette, fontFaceCss, pluginFont }), context);
        // Re-evaluate fixed publisher sizes too: a readable 14px note can become
        // too small when the reader increases their body font to 24px.
        for (const { doc } of renderer.getContents()) normalizeReaderTextSizes(doc);
        styled.resolve();
      };
      const run = async () => {
        // An imported font ships its @font-face pointing at the blob store
        // straight away — no download seam: bytes already local render now,
        // bytes still syncing render the fallback until `user-fonts-changed`
        // re-injects.
        const userId = userFontId(settings.fontFamily);
        if (userId) {
          const entry = findUserFont(settings.fontFamily, getDefaultStore().get(userFontsAtom));
          if (owns()) apply(entry?.bytesLocal ? userFontFaceCss(entry) : "");
          return;
        }
        const id = curatedFontId(settings.fontFamily);
        if (!id) {
          if (owns()) apply(pluginFont ? pluginFontFaceCss(pluginFont) : "");
          return;
        }
        const weights = readerFontWeightsNeeded(settings.fontWeight, settings.fontFamily);
        const local = await localCuratedFontFaceCss(id, weights);
        if (!owns()) return;
        apply(local ?? "");
        if (local !== null) return;
        const downloaded = await ensureCuratedFontFaceCss(id, weights).catch((error: unknown) => {
          log.warn("Reader font download failed; keeping the fallback font", error);
          return null;
        });
        if (downloaded !== null && owns()) apply(downloaded);
      };
      run().catch((error: unknown) => styled.reject(error));
      return styled.promise;
    },
    [viewRef, pluginFonts, pluginThemes],
  );

  const prepareStyles = useCallback((settings: ReaderSettings) => {
    const id = curatedFontId(settings.fontFamily);
    // Warms the session memo that injectStyles reads; it never rejects.
    if (id) void localCuratedFontFaceCss(id, readerFontWeightsNeeded(settings.fontWeight, settings.fontFamily));
  }, []);

  const applyPageColors = useCallback(
    (settings: ReaderSettings, renderer = viewRef.current?.renderer, origin?: DomainActor) => {
      if (!renderer || !("setPageColors" in renderer)) return;
      renderer.setPageColors(
        fixedLayoutPageColors(resolveReaderPalette(settings.theme, pluginThemes), settings.fixedLayoutColor),
        readingRenderContext(origin ?? (eventCause(settings) ? actorFromEvent(settings) : "system")),
      );
    },
    [viewRef, pluginThemes],
  );

  // Settings change -> re-inject reader CSS, refresh the text measure, and
  // redraw a fixed-layout book in the new palette.
  useEffect(() => {
    const previous = previousInputs.current;
    const sources: object[] = [];
    if (previous?.settings !== readerSettings)
      sources.push(eventCause(readerSettings) ? readerSettings : stampEventCause({}));
    // Choosing a different preference belongs to that settings write. Only a
    // change to the already selected registration contributes its own cause.
    if (previous?.settings.fontFamily === readerSettings.fontFamily && previous.font !== font) sources.push(font);
    if (previous?.settings.theme === readerSettings.theme && previous.theme !== theme) sources.push(theme);
    // A `user:` font's registry row arriving (import on another device) or its
    // `bytesLocal` flipping (bytes landed from the relay) changes the CSS.
    if (previous?.settings.fontFamily === readerSettings.fontFamily && previous.userFont !== userFont)
      sources.push(stampEventCause({}));
    if (!sources.length && !needsStyles.current) return;
    const origin = sources.length ? actorFromEvent(mergeEventCauses(sources, {})) : previous!.origin;
    previousInputs.current = { settings: readerSettings, font, theme, userFont, origin };
    needsStyles.current = false;
    settingsRef.current = readerSettings;
    injectStyles(readerSettings, undefined, origin).catch((error: unknown) =>
      log.error("Could not apply reader styles", error),
    );
    applyMaxInlineSize(origin);
    applyPageColors(readerSettings, undefined, origin);
  }, [readerSettings, font, theme, userFont, applyMaxInlineSize, injectStyles, applyPageColors]);

  return { settingsRef, applyMaxInlineSize, injectStyles, prepareStyles, applyPageColors };
}
