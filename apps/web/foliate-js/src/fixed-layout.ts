import type {
  Anchor,
  Book,
  BookSection,
  MaybePromise,
  PageColors,
  PageSource,
  Rendition,
  ResolvedNavigation,
} from "./book.js";
import { anchorElement, anchorRange, anchorValue, isRange } from "./navigation.js";
import type { Overlayer } from "./overlayer.js";
import type { Content, RelocateReason, NativeInputBridge } from "./renderer.js";
import { RendererResizeObserver } from "./resize-observer.js";
import { getViewport, parseViewport, type Dimensions } from "./viewport.js";
import {
  DEFAULT_FIXED_LAYOUT_ZOOM,
  normalizeFixedLayoutZoom,
  resolveFixedLayoutFit,
  sameFixedLayoutZoom,
  type FixedLayoutZoom,
} from "./fixed-zoom.js";

// READAWARE: rendering budgets, canvas-memory driven. A PDF page rastered at
// fit-width on a Retina display runs ~12–17 MB of RGBA; a dozen live pages
// ≈ 150–200 MB, which WKWebView tolerates — rastering a whole 200-page scan
// would not be. Documents at or under FULL_RENDER_MAX_SPREADS keep every page
// alive once rendered; larger ones keep a window around the reading position.
const FULL_RENDER_MAX_SPREADS = 12;

// Paged flows: spreads prerendered around the current one, and the LRU cap on
// live cached spreads beyond which the farthest are dropped.
const PRELOAD_SPREADS_AHEAD = 2;
const PRELOAD_SPREADS_BEHIND = 1;
const CACHE_MAX_SPREADS = 10;

// Scrolled flow (a continuous stack of pages): how far beyond the viewport
// pages are kept rendered, in viewport heights. Promotion is what gets built
// as the reader approaches; demotion is where a live page is torn back down
// to its placeholder — wider, so scrolling back and forth doesn't churn.
const STACK_AHEAD_VIEWPORTS = 2.5;
const STACK_BEHIND_VIEWPORTS = 1.5;
const STACK_KEEP_AHEAD_VIEWPORTS = 5;
const STACK_KEEP_BEHIND_VIEWPORTS = 3;

// READAWARE: zoom rastering. A live zoom (a pinch, a ctrl+wheel stream)
// re-presents the pages' current rasters at every step and rasters anew only
// once the zoom has held still this long — rastering at every step would
// start and cancel a page-sized draw per event. A discrete zoom (a key, a
// button) rasters at once.
const ZOOM_SETTLE_MS = 160;
// The sharp overlay of a zoomed page follows the viewport once scrolling or
// panning has paused this long (see pdf-detail.ts).
const DETAIL_SETTLE_MS = 120;

/** A point in client coordinates the zoom keeps still. */
export type ZoomAnchor = { x: number; y: number };
export type SetZoomOptions = {
  /** Kept under the same page point; the viewport's center by default. */
  anchor?: ZoomAnchor;
  /** Part of a live gesture: present now, raster once it settles. */
  live?: boolean;
  context?: object;
};
/** A point of the page being read, as fractions of its box (see `FixedLayout.viewFocus`). */
export type ViewFocus = { index: number; x: number; y: number };
/** Which edges of a zoomed paged spread the viewport rests against. */
export type PanEdges = { left: boolean; right: boolean; top: boolean; bottom: boolean };
/** Where a page arrived at by a page turn is first shown. */
type PageEdge = "start" | "end";
type ZoomHold = { point: ZoomAnchor; fx: number; fy: number; slot: HTMLElement | null };

type FrameBase = {
  hidden: boolean;
  element: HTMLDivElement;
  iframe: HTMLIFrameElement;
  overlay: HTMLDivElement;
  index: number;
  overlayer?: Overlayer;
  renderedScale?: number | null;
  renderingScale?: number | null;
  failedScale?: number | null;
  failCount?: number;
  renderAbort?: AbortController | null;
  renderPromise?: Promise<void>;
  renderError?: unknown;
  detailAbort?: AbortController | null;
};
type FixedFrame = FrameBase &
  (
    | {
        blank: true;
        doc?: never;
        width?: never;
        height?: never;
        onZoom?: never;
        onPresent?: never;
        onDetail?: never;
      }
    | {
        blank?: false;
        doc: Document;
        width: number;
        height: number;
        onZoom?: PageSource["onZoom"] | null;
        onPresent?: PageSource["onPresent"] | null;
        onDetail?: PageSource["onDetail"] | null;
      }
  );
type Side = "left" | "right" | "center";
type FixedSpread = Partial<Record<Side, BookSection>>;
type SpreadFrames = Partial<Record<Side, FixedFrame>>;

type StackEntry = {
  slot: HTMLDivElement;
  frame: FixedFrame | null;
  framePromise: Promise<FixedFrame | null> | null;
  width: number;
  height: number;
  /** Height at the fit, before the zoom factor (see `#sizeSlot`). */
  fitHeight: number;
  pixelHeight: number;
  top: number;
};

export class FixedLayout extends HTMLElement {
  inputBridge?: NativeInputBridge;
  book: Book | undefined;
  rtl = false;

  static observedAttributes = ["flow", "max-column-count"];
  #root = this.attachShadow({ mode: "closed" });
  #observer = new RendererResizeObserver(
    () => this.#positionContext,
    (context) => this.#onResize(context),
  );
  #spreads: FixedSpread[] = [];
  #index = -1;
  #displayedIndex = -1;
  #navigation = 0;
  #positionContext: object = {};
  #stackScrollFeedback: { position: number; context: object } | undefined;
  #clearScrollFeedback = () => {
    this.#stackScrollFeedback = undefined;
  };
  defaultViewport: Rendition["viewport"];
  spread: string | undefined;
  #portrait = false;
  #left: FixedFrame | null = null;
  #right: FixedFrame | null = null;
  #center: FixedFrame | null = null;
  #side: Side | undefined;
  // READAWARE: replaces upstream's `zoom` attribute (a number or a fit
  // keyword, which nothing set) with a fit and a factor over it — see
  // fixed-zoom.ts — applied through `setZoom`.
  #zoom: FixedLayoutZoom = DEFAULT_FIXED_LAYOUT_ZOOM;
  // While a live zoom is in progress, frames are re-presented but not
  // rastered; `#zoomSettleTimer` ends it.
  #zoomLive = false;
  #zoomSettleTimer: ReturnType<typeof setTimeout> | 0 = 0;
  #viewLocked = false;
  #detailTimer: ReturnType<typeof setTimeout> | 0 = 0;
  #flow: string | null = null;
  #maxColumnCount: number | undefined;
  // READAWARE: `{ background, foreground? }`, or null to render as authored.
  // Page colors are baked in at render time rather than filtered afterwards,
  // so changing them has to redraw every live frame — see setPageColors.
  #pageColors: PageColors = null;
  // READAWARE: paged-flow spread cache. `#framePromises` holds in-flight and
  // settled creations (a preload and a navigation racing on the same spread
  // share one set of iframes); `#liveFrames` holds settled ones — what
  // rendering, page colors, and eviction iterate. `#lru` orders spread
  // indexes by recency for eviction.
  #framePromises = new Map<number, Promise<SpreadFrames>>();
  #liveFrames = new Map<number, SpreadFrames>();
  #lru: number[] = [];
  #frameGeneration = 0;
  #preloadToken = 0;
  // READAWARE: scrolled-flow page stack. One sized slot per spread keeps the
  // scrollbar honest for the whole document; a slot holds a live frame only
  // while the reader is near it. `#stack` entries:
  // { slot, frame, framePromise, width, height, sized }.
  #stack: StackEntry[] | null = null;
  // READAWARE: the stack's slots live in this column rather than directly on
  // the host: at least as wide as the viewport and as wide as the widest
  // page, it centers every page against the widest one, and a page zoomed
  // past the viewport overflows to the right, where scrolling reaches it
  // (flex centering on the host would push it off the left edge for good).
  #stackColumn: HTMLDivElement | null = null;
  #stackCurrent = 0;
  #stackLive = new Set<number>();
  #stackWanted = new Set<number>();
  #stackDraining = false;
  #stackScrollTimer: ReturnType<typeof setTimeout> | 0 = 0;
  #stackReportTimer: ReturnType<typeof setTimeout> | 0 = 0;
  #stackDefaultDims: Dimensions | null = null;
  // READAWARE: trailing setTimeout throttle, deliberately not rAF — WKWebView
  // suspends animation frames entirely while the window is occluded, and the
  // window logic must not silently die with them.
  #onStackScroll = () => {
    if (!this.#stack || this.#stackScrollTimer) return;
    this.#stackScrollTimer = setTimeout(() => {
      this.#stackScrollTimer = 0;
      const feedback = this.#stackScrollFeedback;
      this.#updateStackWindow("scroll", feedback?.position === this.scrollTop ? feedback.context : {});
    }, 32);
  };
  // A zoomed page's sharp overlay follows the viewport, in either flow.
  #onScrollDetail = () => this.#scheduleDetail();
  constructor() {
    super();

    const sheet = new CSSStyleSheet();
    this.#root.adoptedStyleSheets = [sheet];
    // READAWARE: pages are centered with auto margins (set per frame in
    // `#render`, and by the stack column), not by the host's own centering.
    // Auto margins collapse to zero once a zoomed page outgrows the
    // viewport, so it overflows where scrolling reaches it; `center` would
    // split the overflow and strand its left and top beyond reach.
    sheet.replaceSync(`:host {
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: flex-start;
            align-items: flex-start;
            overflow: auto;
        }
        :host([flow="scrolled"]) {
            flex-direction: column;
            overscroll-behavior: contain;
        }
        :host([view-locked]:not([flow="scrolled"])) {
            overflow: hidden;
        }`);

    this.#observer.observe(this);
    this.addEventListener("scroll", this.#onStackScroll, { passive: true });
    this.addEventListener("scroll", this.#onScrollDetail, { passive: true });
    for (const name of ["wheel", "touchstart", "keydown"])
      this.addEventListener(name, this.#clearScrollFeedback, { capture: true, passive: true });
  }
  attributeChangedCallback(name: string, _: string | null, value: string | null) {
    switch (name) {
      case "flow":
        if (value === this.#flow) break;
        this.#flow = value;
        this.#rebuildSpreads();
        break;
      case "max-column-count":
        {
          const maxColumnCount = parseInt(value ?? "");
          if (maxColumnCount === this.#maxColumnCount) break;
          this.#maxColumnCount = maxColumnCount;
          this.#rebuildSpreads();
        }
        break;
    }
  }
  // READAWARE: `parent` — paged frames mount on the shadow root, scrolled
  // frames mount inside their page's slot.
  async #createFrame(
    { index, src: srcOption }: { index: number; src?: string | PageSource },
    parent: ShadowRoot | HTMLDivElement = this.#root,
    context = this.#positionContext,
  ): Promise<FixedFrame> {
    const srcOptionIsString = typeof srcOption === "string";
    const src = srcOptionIsString ? srcOption : srcOption?.src;
    const onZoom = srcOptionIsString ? null : srcOption?.onZoom;
    const onPresent = srcOptionIsString ? null : srcOption?.onPresent;
    const onDetail = srcOptionIsString ? null : srcOption?.onDetail;
    const element = document.createElement("div");
    element.setAttribute("dir", "ltr");
    // READAWARE: annotation overlays are positioned against this box.
    element.style.position = "relative";
    // READAWARE: frames are born invisible; `#showFrames` (paged) or the
    // stack layout (scrolled) reveals them. `visibility` instead of
    // `display` keeps the composited layers of a cached page alive, so
    // revealing it cannot flash.
    element.style.visibility = "hidden";
    const iframe = document.createElement("iframe");
    element.append(iframe);
    // READAWARE: the overlayer's SVG lives in the host document, above the
    // frame, and its geometry mirrors the iframe's exactly — ranges are
    // measured inside the iframe, so the two boxes must share a coordinate
    // space for a highlight to land on its own words.
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "absolute",
      top: "0",
      left: "0",
      transformOrigin: "top left",
      pointerEvents: "none",
      display: "none",
    });
    element.append(overlay);
    Object.assign(iframe.style, {
      border: "0",
      display: "none",
      overflow: "hidden",
    });
    // `allow-scripts` is needed for events because of WebKit bug
    // https://bugs.webkit.org/show_bug.cgi?id=218086
    iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute("part", "filter");
    parent.append(element);
    if (!src) return { blank: true, hidden: true, element, iframe, overlay, index };
    return new Promise<FixedFrame>((resolve, reject) => {
      const fail = (error: Error) => {
        element.remove();
        reject(error);
      };
      iframe.addEventListener("error", () => fail(new Error("Could not load fixed-layout page")), { once: true });
      iframe.addEventListener(
        "load",
        () => {
          const doc = iframe.contentDocument;
          if (!doc) return fail(new Error("Fixed-layout page document is inaccessible"));
          for (const name of ["wheel", "touchstart", "keydown"])
            doc.addEventListener(name, this.#clearScrollFeedback, { capture: true, passive: true });
          doc.addEventListener(
            "wheel",
            (event) => {
              // ctrl+wheel is a pinch (or a zoom chord), never a scroll.
              if (!this.scrolled || event.ctrlKey) return;
              event.preventDefault();
              this.scrollBy({ top: event.deltaY, left: event.deltaX });
            },
            { passive: false },
          );
          // READAWARE: no 'load' event here. Upstream announced a frame
          // the moment its iframe loaded, which was per-navigation only
          // because frames died on navigation. Paged flows announce from
          // `#showFrames` each time a spread becomes current; the
          // scrolled stack announces once per created frame. Consumers
          // attach per-document listeners on 'load' and must dedupe.
          const { width, height } = getViewport(doc, this.defaultViewport);
          const frame = {
            element,
            iframe,
            overlay,
            index,
            doc,
            hidden: true,
            width,
            height,
            onZoom,
            onPresent,
            onDetail,
          };
          // READAWARE: a lazily rendered page (PDF) has no text layer at
          // load time — there would be nothing for a CFI to anchor to.
          // Those frames get their overlayer once rendering finishes.
          if (!onZoom) this.#createOverlayer(frame, context);
          resolve(frame);
        },
        { once: true },
      );
      iframe.src = src;
    });
  }
  // READAWARE: hand the view a fresh overlayer for this frame and mount its
  // element. Re-callable: a re-rendered page needs its annotations rebuilt
  // from their CFIs, because the ranges pointed into the discarded DOM.
  #createOverlayer(frame: FixedFrame, context: object) {
    if (!frame?.doc) return;
    this.dispatchEvent(
      new CustomEvent("create-overlayer", {
        detail: {
          doc: frame.doc,
          index: frame.index,
          context,
          attach: (overlayer: Overlayer) => {
            frame.overlayer = overlayer;
            frame.overlay.replaceChildren(overlayer.element);
            frame.overlay.style.display = "block";
          },
        },
      }),
    );
  }
  // READAWARE: kick a lazily rendered frame (PDF) at a given scale if its
  // raster is stale. Bookkeeping is success-based: `renderedScale` is only
  // set when a render COMPLETES, `renderingScale` marks the one in flight,
  // and a cancelled or failed render leaves the frame retryable — the old
  // requested-marks-done bookkeeping turned any transient failure into a
  // permanently blank page. Renders are cancellable through the signal the
  // PDF layer honors; a stale in-flight render (scale or palette changed)
  // is cancelled rather than raced.
  #renderFrameAt(frame: FixedFrame | null | undefined, scale: number, context = this.#positionContext) {
    if (!frame?.onZoom) return;
    // A live zoom re-rasters nothing until it settles (see `setZoom`): a
    // page that has a raster is presented from it meanwhile. A page with
    // none — scrolled into view mid-pinch — rasters at once, or it would
    // sit blank until the fingers lift.
    if (this.#zoomLive && (frame.renderedScale != null || frame.renderingScale != null || frame.failedScale != null))
      return;
    if (frame.renderedScale === scale || frame.renderingScale === scale) return;
    // Two strikes at one scale and the page stops hammering a render that
    // cannot succeed; a scale change resets the count.
    if (frame.failedScale === scale && (frame.failCount ?? 0) >= 2) return;
    this.#cancelFrameRender(frame);
    const controller = new AbortController();
    frame.renderAbort = controller;
    frame.renderingScale = scale;
    frame.renderError = undefined;
    frame.renderPromise = frame
      .onZoom({
        doc: frame.doc,
        scale,
        pageColors: this.#pageColors,
        signal: controller.signal,
      })
      .then(() => {
        if (frame.renderAbort !== controller) return;
        frame.renderedScale = scale;
        frame.renderError = undefined;
        frame.failedScale = null;
        frame.failCount = 0;
        this.dispatchEvent(new CustomEvent("rendered", { detail: { context, index: frame.index } }));
        // The render rebuilt the text layer, so the overlayer's
        // ranges are detached — start it over.
        this.#createOverlayer(frame, context);
        // A zoom past the raster budget sharpens what is on screen.
        if (frame.onDetail) this.#scheduleDetail();
      })
      .catch((error: unknown) => {
        // A cancelled older render no longer owns this frame's verdict.
        if (frame.renderAbort !== controller) return;
        frame.renderError = error;
        if (error instanceof Error && error.name === "RenderCancelledError") return;
        if (frame.failedScale === scale) frame.failCount = (frame.failCount ?? 0) + 1;
        else {
          frame.failedScale = scale;
          frame.failCount = 1;
        }
        console.error(error);
      })
      .finally(() => {
        if (frame.renderAbort === controller) {
          frame.renderAbort = null;
          frame.renderingScale = null;
        }
      });
  }
  /** Cancel a frame's in-flight render (no-op when idle). Synchronous
   *  bookkeeping, so a follow-up `#renderFrameAt` never dedupes against a
   *  corpse. */
  #cancelFrameRender(frame: FixedFrame | null | undefined) {
    if (!frame) return;
    // A sharp overlay belongs to the raster under it.
    this.#cancelFrameDetail(frame);
    const controller = frame?.renderAbort;
    if (!controller) return;
    frame.renderAbort = null;
    frame.renderingScale = null;
    controller.abort();
  }
  #cancelFrameDetail(frame: FixedFrame) {
    frame.detailAbort?.abort();
    frame.detailAbort = null;
  }
  // READAWARE: size a frame's iframe and overlay box for `scale` and show
  // it there at once. An image page scales by transform; a lazily rastered
  // page (PDF) has its current raster re-presented at the new scale until
  // `#renderFrameAt` rasters it anew, its highlights following along.
  #presentFrame(frame: FixedFrame, scale: number, blankWidth = 0, blankHeight = 0) {
    const { iframe, overlay, width, height, blank, onZoom } = frame;
    const iframeScale = onZoom ? scale : 1;
    Object.assign(iframe.style, {
      width: `${(width ?? blankWidth) * iframeScale}px`,
      height: `${(height ?? blankHeight) * iframeScale}px`,
      transform: onZoom ? "none" : `scale(${scale})`,
      transformOrigin: "top left",
      display: blank ? "none" : "block",
    });
    // READAWARE: keep the overlay box in lock-step with the iframe.
    Object.assign(overlay.style, {
      width: `${(width ?? blankWidth) * iframeScale}px`,
      height: `${(height ?? blankHeight) * iframeScale}px`,
      transform: onZoom ? "none" : `scale(${scale})`,
    });
    if (frame.doc && onZoom && frame.onPresent) frame.onPresent(frame.doc, scale);
    // A frame about to raster rebuilds its overlayer when that finishes;
    // every other one only needs its ranges drawn at the new geometry.
    if (!onZoom || frame.renderedScale !== scale) frame.overlayer?.redraw();
  }
  // READAWARE: cached spreads stay in the DOM; only the current one
  // participates in layout and paints. `visibility` (not `display`) so the
  // compositor keeps the hidden page's layers — revealing is then a
  // property flip, never a repaint flash.
  #setFrameHidden(frame: FixedFrame, hidden: boolean) {
    frame.hidden = hidden;
    Object.assign(
      frame.element.style,
      hidden
        ? { visibility: "hidden", position: "absolute", top: "0", left: "0", pointerEvents: "none" }
        : { visibility: "visible", position: "relative", top: "", left: "", pointerEvents: "" },
    );
  }
  // ─── Paged flows (single page / spreads) ─────────────────────────────────
  // READAWARE: the scale a spread renders at, extracted from `#render` so
  // background prerendering computes the same answer for a hidden spread.
  #scaleFor(
    left: FixedFrame | null | undefined,
    right: FixedFrame | null | undefined,
    center: FixedFrame | null | undefined,
    side: Side,
  ) {
    const l: Partial<FixedFrame> = left ?? {};
    const r: Partial<FixedFrame> = center ?? right ?? {};
    const target = side === "left" ? l : r;
    const { width, height } = this.getBoundingClientRect();
    const portrait = !this.scrolled && this.spread !== "both" && this.spread !== "portrait" && height > width;
    const blankWidth = l.width ?? r.width ?? 0;
    const blankHeight = l.height ?? r.height ?? 0;

    // READAWARE: the fit is the zoom's 100%; the factor scales from it.
    const single = portrait || center;
    const fitWidth = single
      ? width / (target.width ?? blankWidth)
      : width / ((l.width ?? blankWidth) + (r.width ?? blankWidth));
    const fitHeight = single
      ? height / (target.height ?? blankHeight)
      : height / Math.max(l.height ?? blankHeight, r.height ?? blankHeight);
    const fit = resolveFixedLayoutFit(this.#zoom.fit, this.scrolled);
    const scale = ((fit === "width" ? fitWidth : Math.min(fitWidth, fitHeight)) || 1) * this.#zoom.factor;
    return { scale, portrait, target, blankWidth, blankHeight };
  }
  #render(side = this.#side, context = this.#positionContext) {
    if (this.scrolled) return this.#layoutStack(context);
    if (!side) return;
    const left = this.#left;
    const right = this.#center ?? this.#right;
    const { scale, portrait, target, blankWidth, blankHeight } = this.#scaleFor(
      this.#left,
      this.#right,
      this.#center,
      side,
    );
    this.#portrait = portrait;

    // READAWARE: the spread is centered by auto margins on its outer edges —
    // a lone page takes both — which collapse to zero once zoom outgrows the
    // viewport (see the host stylesheet).
    const transform = (frame: FixedFrame | null, edges: "both" | "left" | "right") => {
      if (!frame) return;
      const { element, iframe, width, height } = frame;
      if (!iframe) return;
      this.#presentFrame(frame, scale, blankWidth, blankHeight);
      // READAWARE: re-render only when the scale actually changed. A
      // ResizeObserver tick that leaves the scale alone would otherwise
      // redraw the whole page and rebuild its overlayer for nothing.
      this.#renderFrameAt(frame, scale, context);
      const alone = edges === "both" || portrait;
      Object.assign(element.style, {
        width: `${(width ?? blankWidth) * scale}px`,
        height: `${(height ?? blankHeight) * scale}px`,
        overflow: "hidden",
        display: "block",
        flexShrink: "0",
        marginBlock: "auto",
        marginLeft: alone || edges === "left" ? "auto" : "0",
        marginRight: alone || edges === "right" ? "auto" : "0",
      });
      if (portrait && frame !== target) {
        element.style.display = "none";
      }
    };
    if (this.#center) {
      transform(this.#center, "both");
    } else {
      transform(left, "left");
      transform(right, "right");
    }
  }
  // READAWARE: create (or reuse) the frames of one spread. Creations are
  // memoized by promise so a background preload and a user navigation
  // arriving at the same spread share one set of iframes.
  #framesFor(spreadIndex: number, context: object): Promise<SpreadFrames> {
    const pending = this.#framePromises.get(spreadIndex);
    if (pending) return pending;
    const spread = this.#spreads[spreadIndex];
    const book = this.book;
    if (!book || !spread) return Promise.reject(new Error("Fixed-layout spread does not exist"));
    const generation = this.#frameGeneration;
    const promise: Promise<SpreadFrames> = Promise.resolve().then(async () => {
      let frames: SpreadFrames;
      if (spread.center) {
        const index = book.sections.indexOf(spread.center);
        const src = await spread.center?.load?.();
        frames = { center: await this.#createFrame({ index, src }, this.#root, context) };
      } else {
        const indexL = spread.left ? book.sections.indexOf(spread.left) : -1;
        const indexR = spread.right ? book.sections.indexOf(spread.right) : -1;
        const srcL = await spread.left?.load?.();
        const srcR = await spread.right?.load?.();
        frames = {
          left: await this.#createFrame({ index: indexL, src: srcL }, this.#root, context),
          right: await this.#createFrame({ index: indexR, src: srcR }, this.#root, context),
        };
      }
      // Closing the renderer or switching layouts invalidates in-flight
      // creations, not just the frames already present in the cache.
      if (generation !== this.#frameGeneration) {
        this.#eachFrame(frames, (frame) => frame.element.remove());
        throw new DOMException("Fixed-layout page load was cancelled", "AbortError");
      }
      // An evict may have raced this creation (dropping the map rows
      // while the iframes loaded). The frames are real and the caller
      // may be about to show them — re-register unconditionally; the
      // next evict sweep applies the cap again.
      this.#framePromises.set(spreadIndex, promise);
      this.#liveFrames.set(spreadIndex, frames);
      // Into the recency order at creation — a preloaded spread the
      // reader never visits must still be evictable.
      this.#touchLRU(spreadIndex);
      return frames;
    });
    this.#framePromises.set(spreadIndex, promise);
    promise.catch(() => {
      // A failed creation must not poison the spread forever.
      if (this.#framePromises.get(spreadIndex) === promise) {
        this.#framePromises.delete(spreadIndex);
        this.#liveFrames.delete(spreadIndex);
      }
    });
    return promise;
  }
  #eachFrame(frames: SpreadFrames | undefined, fn: (frame: FixedFrame) => void) {
    for (const frame of [frames?.left, frames?.right, frames?.center]) if (frame) fn(frame);
  }
  #showFrames(frames: SpreadFrames, side: Side, context: object) {
    const previous = [this.#left, this.#right, this.#center];
    const next = new Set([frames.left, frames.right, frames.center]);
    this.#left = frames.left ?? null;
    this.#right = frames.right ?? null;
    this.#center = frames.center ?? null;
    this.#side = frames.center ? "center" : this.#left?.blank ? "right" : this.#right?.blank ? "left" : side;
    // READAWARE: size the new spread while it is still hidden and the old
    // one still holds the layout, then swap them in one step. Laying out in
    // between — `#render` measures the host, and so may any 'load' listener
    // — would find the old spread gone and the new one not yet sized: the
    // content collapses for that instant and the browser clamps the scroll
    // position to it, throwing a zoomed view back to its top-left corner.
    this.#render(this.#side, context);
    for (const frame of previous) if (frame && !next.has(frame)) this.#setFrameHidden(frame, true);
    this.#eachFrame(frames, (frame) => this.#setFrameHidden(frame, false));
    // READAWARE: announce the spread's documents on every show — the same
    // per-navigation 'load' consumers always got, now decoupled from
    // iframe creation so cached spreads keep the contract. Listeners that
    // attach to the document must dedupe (the doc may be the same one).
    this.#eachFrame(frames, (frame) => {
      if (frame.doc)
        this.dispatchEvent(
          new CustomEvent("load", {
            detail: { doc: frame.doc, index: frame.index, context },
          }),
        );
    });
  }
  #touchLRU(spreadIndex: number) {
    const at = this.#lru.indexOf(spreadIndex);
    if (at >= 0) this.#lru.splice(at, 1);
    this.#lru.push(spreadIndex);
  }
  #evict() {
    const cap = this.#spreads.length <= FULL_RENDER_MAX_SPREADS ? Infinity : CACHE_MAX_SPREADS;
    if (this.#liveFrames.size <= cap) return;
    // Never evict the spread being read or its immediate window — those
    // are exactly the ones a turn is about to need.
    const keep = new Set();
    for (let i = this.#index - PRELOAD_SPREADS_BEHIND; i <= this.#index + PRELOAD_SPREADS_AHEAD; i++) keep.add(i);
    for (const victim of [...this.#lru]) {
      if (this.#liveFrames.size <= cap) break;
      if (keep.has(victim)) continue;
      const frames = this.#liveFrames.get(victim);
      if (frames)
        this.#eachFrame(frames, (frame) => {
          this.#cancelFrameRender(frame);
          frame.element.remove();
        });
      this.#liveFrames.delete(victim);
      this.#framePromises.delete(victim);
      this.#lru.splice(this.#lru.indexOf(victim), 1);
    }
  }
  // READAWARE: warm the spreads a reader is about to turn to. Small books
  // (≤ FULL_RENDER_MAX_SPREADS) prerender completely, nearest first; larger
  // books keep a sliding window. Strictly sequential, and starting only
  // after the visible spread's own renders settle, so preloading never
  // competes with the page being read for the PDF worker. A newer
  // navigation bumps the token and the stale chain stops where it is —
  // anything it already built stays cached.
  #schedulePreload(context = this.#positionContext) {
    const token = ++this.#preloadToken;
    const origin = this.#index;
    const total = this.#spreads?.length ?? 0;
    if (origin < 0 || total === 0) return;
    const order: number[] = [];
    if (total <= FULL_RENDER_MAX_SPREADS) {
      for (let d = 1; d < total; d++) {
        if (origin + d < total) order.push(origin + d);
        if (origin - d >= 0) order.push(origin - d);
      }
    } else {
      for (let d = 1; d <= PRELOAD_SPREADS_AHEAD; d++) if (origin + d < total) order.push(origin + d);
      for (let d = 1; d <= PRELOAD_SPREADS_BEHIND; d++) if (origin - d >= 0) order.push(origin - d);
    }
    void (async () => {
      const current = [this.#left, this.#right, this.#center];
      await Promise.allSettled(current.flatMap((frame) => (frame?.renderPromise ? [frame.renderPromise] : [])));
      for (const spreadIndex of order) {
        if (token !== this.#preloadToken) return;
        if (spreadIndex === this.#index) continue;
        try {
          const frames = await this.#framesFor(spreadIndex, context);
          if (token !== this.#preloadToken) return;
          const spread = this.#spreads[spreadIndex];
          const side = spread.center ? "center" : this.rtl ? "right" : "left";
          const { scale } = this.#scaleFor(frames.left, frames.right, frames.center, side);
          this.#eachFrame(frames, (frame) => this.#renderFrameAt(frame, scale, context));
          await Promise.allSettled(
            [frames.left, frames.right, frames.center].flatMap((frame) =>
              frame?.renderPromise ? [frame.renderPromise] : [],
            ),
          );
        } catch (error) {
          console.error(error);
        }
        if (token !== this.#preloadToken) return;
        this.#evict();
      }
    })();
  }
  // ─── Scrolled flow: a continuous stack of pages ──────────────────────────
  // READAWARE: upstream's scrolled flow was still one spread at a time —
  // scrolling reached the bottom of a page and the next one replaced it
  // wholesale. This is a real continuous scroller instead: every page owns
  // a correctly-sized slot (so the scrollbar and jump targets are honest
  // for the whole document), and only slots near the viewport hold live,
  // rendered frames. Far pages tear back down to their placeholders.
  #stackDims(entry: StackEntry): Dimensions {
    if (entry.width && entry.height) return entry;
    if (this.#stackDefaultDims) return this.#stackDefaultDims;
    const viewport = parseViewport(this.defaultViewport);
    if (viewport) return viewport;
    return { width: 1000, height: 1414 };
  }
  // READAWARE: `width` may be passed by batch callers — reading
  // `clientWidth` forces a synchronous reflow, and doing that once per slot
  // while appending thousands of slots is O(n²) layout (9 s of the open
  // time of a 3,246-page book, measured).
  #stackScale(entry: StackEntry, viewport = this.#stackViewport()) {
    return this.#stackFit(entry, viewport) * this.#zoom.factor;
  }
  // READAWARE: each page fits on its own terms — a stack may mix sizes —
  // and the zoom factor scales from that fit.
  #stackFit(entry: StackEntry, viewport: Dimensions) {
    const dims = this.#stackDims(entry);
    const fitWidth = viewport.width / dims.width;
    const fit =
      resolveFixedLayoutFit(this.#zoom.fit, true) === "width"
        ? fitWidth
        : Math.min(fitWidth, viewport.height / dims.height);
    return fit || 1;
  }
  /** The reading area the stack fits pages to. Each read forces layout — see `#stackScale`'s batch callers. */
  #stackViewport(): Dimensions {
    return { width: this.clientWidth, height: this.clientHeight };
  }
  #buildStack() {
    this.#teardownStack();
    const total = this.#spreads.length;
    this.#stack = Array.from({ length: total }, () => ({
      slot: document.createElement("div"),
      frame: null,
      framePromise: null,
      width: 0,
      height: 0,
      fitHeight: 0,
      pixelHeight: 0,
      top: 0,
    }));
    const column = document.createElement("div");
    Object.assign(column.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      flexShrink: "0",
      minWidth: "100%",
      width: "max-content",
    });
    column.style.setProperty("--fxl-zoom", String(this.#zoom.factor));
    this.#stackColumn = column;
    // One viewport read and one DOM insertion for the whole stack.
    const viewport = this.#stackViewport();
    const fragment = document.createDocumentFragment();
    for (const entry of this.#stack) {
      Object.assign(entry.slot.style, {
        position: "relative",
        flexShrink: "0",
        overflow: "hidden",
      });
      this.#sizeSlot(entry, viewport);
      fragment.append(entry.slot);
    }
    column.append(fragment);
    this.#root.append(column);
    this.#restackTops();
  }
  // READAWARE: a slot is sized at the fit, times the column's `--fxl-zoom`,
  // so a zoom step restyles one property rather than every page of the
  // book (see `#rezoomStack`) — with thousands of pages, the difference
  // between a pinch that tracks the fingers and one that stutters.
  #sizeSlot(entry: StackEntry, viewport = this.#stackViewport()) {
    const dims = this.#stackDims(entry);
    const fit = this.#stackFit(entry, viewport);
    entry.fitHeight = dims.height * fit;
    entry.pixelHeight = entry.fitHeight * this.#zoom.factor;
    entry.slot.style.width = `calc(var(--fxl-zoom) * ${dims.width * fit}px)`;
    entry.slot.style.height = `calc(var(--fxl-zoom) * ${entry.fitHeight}px)`;
    // A slot whose page isn't rastered yet shows as sheet-colored paper,
    // not a white slab in a dark room.
    entry.slot.style.background = this.#pageColors?.background ?? "";
  }
  // READAWARE: slot offsets are tracked arithmetically — `offsetTop` is not
  // dependable across a shadow boundary, and a 3000-slot layout read per
  // scroll frame would thrash anyway.
  #restackTops() {
    let top = 0;
    for (const entry of this.#stack ?? []) {
      entry.top = top;
      top += entry.pixelHeight;
    }
  }
  #teardownStack() {
    if (!this.#stack) return;
    for (const i of [...this.#stackLive]) this.#demoteStackFrame(i);
    for (const entry of this.#stack) entry.slot.remove();
    this.#stackColumn?.remove();
    this.#stackColumn = null;
    this.#stack = null;
    this.#stackLive.clear();
    this.#stackWanted.clear();
    if (this.#stackReportTimer) clearTimeout(this.#stackReportTimer);
  }
  /** The stack entry whose slot contains the viewport's center line. */
  #stackIndexAt(scrollCenter: number) {
    if (!this.#stack?.length) return 0;
    let lo = 0,
      hi = this.#stack.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const entry = this.#stack[mid];
      if (entry.top + entry.pixelHeight <= scrollCenter) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  async #ensureStackFrame(entryIndex: number, context: object): Promise<FixedFrame | null> {
    const entry = this.#stack?.[entryIndex];
    if (!entry || !this.book) return null;
    if (entry.framePromise) return entry.framePromise;
    this.#stackLive.add(entryIndex);
    const spread = this.#spreads[entryIndex];
    const section = spread.center ?? spread.left ?? spread.right;
    const sectionIndex = section ? this.book.sections.indexOf(section) : -1;
    const promise: Promise<FixedFrame | null> = Promise.resolve().then(async () => {
      const section = spread.center ?? spread.left ?? spread.right;
      const src = await section?.load?.();
      const frame = await this.#createFrame({ index: sectionIndex, src }, entry.slot, context);
      // The stack may have been torn down (mode switch), or this entry
      // demoted (scrolled far away), while the iframe was loading — a
      // demoted creation must NOT resurrect itself, or the frame
      // becomes an orphan no sweep tracks. The drain re-creates it if
      // the reader comes back.
      if (this.#stack?.[entryIndex] !== entry || entry.framePromise !== promise) {
        frame.element.remove();
        return null;
      }
      entry.frame = frame;
      if (!frame.blank) {
        // First real page dimensions become the placeholder default,
        // and this page's own slot takes its exact size. Growth above
        // the viewport would shove the reading position — compensate.
        this.#stackDefaultDims ??= { width: frame.width, height: frame.height };
        const before = entry.pixelHeight;
        entry.width = frame.width;
        entry.height = frame.height;
        this.#sizeSlot(entry);
        const delta = entry.pixelHeight - before;
        if (delta !== 0) {
          this.#restackTops();
          // Growth above the reading position would shove the page
          // under the reader — keep the view anchored.
          if (entry.top < this.scrollTop) this.#setStackScroll(this.scrollTop + delta, context);
        }
      }
      Object.assign(frame.element.style, {
        position: "absolute",
        top: "0",
        left: "0",
        visibility: "visible",
      });
      frame.hidden = false;
      if (frame.doc)
        this.dispatchEvent(
          new CustomEvent("load", {
            detail: { doc: frame.doc, index: frame.index, context },
          }),
        );
      this.#layoutStackFrame(entry, context);
      return frame;
    });
    entry.framePromise = promise;
    promise.catch(() => {
      if (this.#stack?.[entryIndex] === entry) {
        entry.framePromise = null;
        entry.frame = null;
        this.#stackLive.delete(entryIndex);
      }
    });
    return promise;
  }
  #layoutStackFrame(entry: StackEntry, context: object, viewport = this.#stackViewport()) {
    const frame = entry.frame;
    if (!frame || frame.blank) return;
    const scale = this.#stackScale(entry, viewport);
    this.#presentFrame(frame, scale);
    this.#renderFrameAt(frame, scale, context);
  }
  /**
   * A new zoom factor over unchanged fits: one property, arithmetic tops.
   * `updateWindow: false` leaves the reading window to a caller that moves
   * the scroll position first — decided against the old position, it would
   * name a page the reader is not on and could report it.
   */
  #rezoomStack(context = this.#positionContext, updateWindow = true) {
    if (!this.#stack) return;
    this.#stackColumn?.style.setProperty("--fxl-zoom", String(this.#zoom.factor));
    for (const entry of this.#stack) entry.pixelHeight = entry.fitHeight * this.#zoom.factor;
    this.#restackTops();
    const viewport = this.#stackViewport();
    for (const i of this.#stackLive) {
      const entry = this.#stack[i];
      if (entry) this.#layoutStackFrame(entry, context, viewport);
    }
    if (updateWindow) this.#updateStackWindow("layout", context);
  }
  #demoteStackFrame(entryIndex: number) {
    const entry = this.#stack?.[entryIndex];
    if (!entry || (!entry.frame && !entry.framePromise)) return;
    const frame = entry.frame;
    if (frame) {
      this.#cancelFrameRender(frame);
      frame.element.remove();
    }
    entry.frame = null;
    entry.framePromise = null;
    this.#stackLive.delete(entryIndex);
  }
  /** Resize every slot for the viewport and fit; `updateWindow` as in `#rezoomStack`. */
  #layoutStack(context = this.#positionContext, updateWindow = true) {
    if (!this.#stack) return;
    const viewport = this.#stackViewport();
    this.#stackColumn?.style.setProperty("--fxl-zoom", String(this.#zoom.factor));
    for (const entry of this.#stack) this.#sizeSlot(entry, viewport);
    this.#restackTops();
    for (const i of this.#stackLive) {
      const entry = this.#stack[i];
      if (entry) this.#layoutStackFrame(entry, context, viewport);
    }
    if (updateWindow) this.#updateStackWindow("layout", context);
  }
  // READAWARE: the heart of the scrolled flow — called on scroll (throttled),
  // on resize, and after navigations. Reports the new reading position,
  // recomputes the wanted window (binary search over slot offsets, never a
  // full sweep of thousands of entries), demotes what fell out of the keep
  // range, and kicks the drain loop that does the actual work.
  #updateStackWindow(reason: RelocateReason | "layout", context: object) {
    if (!this.#stack?.length) return;
    this.#positionContext = context;
    const height = this.clientHeight;
    const top = this.scrollTop;
    const center = top + height / 2;
    const current = this.#stackIndexAt(center);
    if (current !== this.#stackCurrent || this.#index < 0) {
      this.#stackCurrent = current;
      this.#index = current;
      // Debounced: a fling crosses many pages; report where it rests.
      if (this.#stackReportTimer) clearTimeout(this.#stackReportTimer);
      const navigation = this.#navigation,
        generation = this.#frameGeneration;
      this.#stackReportTimer = setTimeout(() => {
        this.#stackReportTimer = 0;
        if (this.#stackCurrent === current && this.#navigation === navigation && this.#frameGeneration === generation)
          this.#reportLocation(reason === "layout" ? "page" : reason, null, context);
      }, 120);
    }

    const full = this.#stack.length <= FULL_RENDER_MAX_SPREADS;
    const wanted = new Set<number>();
    if (full) {
      for (let i = 0; i < this.#stack.length; i++) wanted.add(i);
    } else {
      const first = this.#stackIndexAt(top - height * STACK_BEHIND_VIEWPORTS);
      const last = this.#stackIndexAt(top + height * (1 + STACK_AHEAD_VIEWPORTS));
      for (let i = first; i <= last; i++) wanted.add(i);
      const keepFirst = this.#stackIndexAt(top - height * STACK_KEEP_BEHIND_VIEWPORTS);
      const keepLast = this.#stackIndexAt(top + height * (1 + STACK_KEEP_AHEAD_VIEWPORTS));
      for (const i of [...this.#stackLive]) {
        if (i < keepFirst || i > keepLast) this.#demoteStackFrame(i);
        // Kept but no longer wanted: stop spending the main thread on
        // its raster — the reader is moving away from it.
        else if (!wanted.has(i)) this.#cancelFrameRender(this.#stack[i]?.frame);
      }
    }
    this.#stackWanted = wanted;
    void this.#drainStack();
  }
  /**
   * READAWARE: the single consumer that builds and renders wanted pages,
   * nearest-to-the-reader first. It re-picks after every await, so a scroll
   * that moved the window mid-render simply changes what gets picked next —
   * no restarts, no lost work, and the current page always wins the PDF
   * worker. Lives until nothing in the wanted set needs work.
   */
  async #drainStack() {
    if (this.#stackDraining) return;
    this.#stackDraining = true;
    try {
      for (;;) {
        if (!this.#stack) return;
        const current = this.#stackCurrent;
        let best: number | null = null;
        let bestDistance = Infinity;
        for (const i of this.#stackWanted) {
          const entry = this.#stack[i];
          if (!entry || !this.#stackEntryNeedsWork(entry)) continue;
          const distance = Math.abs(i - current);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = i;
          }
        }
        if (best === null) {
          // Nothing to start — but renders may be in flight; wait
          // for one to settle and re-check rather than exiting with
          // work outstanding.
          const inflight = [...this.#stackWanted].flatMap((i) => {
            const frame = this.#stack?.[i]?.frame;
            return frame?.renderingScale != null && frame.renderPromise ? [frame.renderPromise] : [];
          });
          if (inflight.length === 0) return;
          await Promise.race(inflight);
          continue;
        }
        const entry = this.#stack[best];
        const context = this.#positionContext;
        try {
          const frame = await this.#ensureStackFrame(best, context);
          if (!this.#stack || this.#stack[best] !== entry) continue;
          if (frame && entry.frame === frame) {
            this.#layoutStackFrame(entry, context);
            await frame.renderPromise;
          }
        } catch (error) {
          console.error(error);
        }
      }
    } finally {
      this.#stackDraining = false;
    }
  }
  /** Needs creating, or needs (re)rendering at the current scale and hasn't
   *  struck out. Mirrors `#renderFrameAt`'s own guards so the drain loop
   *  cannot spin on a page it would refuse to render. */
  #stackEntryNeedsWork(entry: StackEntry) {
    const frame = entry.frame;
    // No frame yet: creating (or waiting to create) — the drain awaits
    // the shared creation promise and then kicks the render.
    if (!frame) return true;
    if (frame.blank || !frame.onZoom) return false;
    // A live zoom only gives unrastered pages their first raster (see
    // `#renderFrameAt`); its settling wakes the drain for the rest.
    // A page whose raster failed waits for the settled scale to retry.
    if (this.#zoomLive) return frame.renderedScale == null && frame.renderingScale == null && frame.failedScale == null;
    const scale = this.#stackScale(entry);
    if (frame.renderedScale === scale || frame.renderingScale === scale) return false;
    if (frame.failedScale === scale && (frame.failCount ?? 0) >= 2) return false;
    return true;
  }
  #setStackScroll(top: number, context: object) {
    this.scrollTop = top;
    this.#stackScrollFeedback = { position: this.scrollTop, context };
  }
  async #goToStack(index: number, reason: RelocateReason, context: object) {
    if (!this.#stack?.length) return;
    const clamped = Math.max(0, Math.min(index, this.#stack.length - 1));
    const entry = this.#stack[clamped];
    this.#stackCurrent = clamped;
    this.#index = clamped;
    if (this.#stackReportTimer) {
      clearTimeout(this.#stackReportTimer);
      this.#stackReportTimer = 0;
    }
    this.#setStackScroll(entry.top, context);
    this.#updateStackWindow("navigation", context);
    this.#reportLocation(reason, null, context);
    await this.#ensureStackFrame(clamped, context);
  }
  // ─── Zoom ────────────────────────────────────────────────────────────────
  get zoom(): FixedLayoutZoom {
    return this.#zoom;
  }
  /**
   * READAWARE: zoom the pages (see fixed-zoom.ts), keeping the page point
   * under `anchor` where it is. A `live` step — one of many in a pinch —
   * re-presents the current rasters at once and rasters only when the zoom
   * has held still; anything else rasters now, settling any live zoom.
   */
  setZoom(zoom: FixedLayoutZoom, { anchor, live = false, context = {} }: SetZoomOptions = {}) {
    const next = normalizeFixedLayoutZoom(zoom);
    if (sameFixedLayoutZoom(next, this.#zoom)) {
      if (!live && this.#zoomLive) this.#settleZoom(context);
      return;
    }
    const held = this.#captureZoomAnchor(anchor);
    const refit = next.fit !== this.#zoom.fit;
    this.#zoom = next;
    this.#positionContext = context;
    if (live && !this.#zoomLive) {
      // Re-rasters started for the old scale are no longer wanted; a page's
      // first raster still is.
      this.#zoomLive = true;
      this.#eachLiveFrame((frame) => {
        if (frame.renderedScale != null) this.#cancelFrameRender(frame);
      });
    }
    if (this.scrolled) {
      if (refit) this.#layoutStack(context, false);
      else this.#rezoomStack(context, false);
    } else this.#render(this.#side, context);
    this.#restoreZoomAnchor(held);
    if (this.scrolled) this.#updateStackWindow("layout", context);
    if (this.#zoomSettleTimer) clearTimeout(this.#zoomSettleTimer);
    this.#zoomSettleTimer = 0;
    if (live) this.#zoomSettleTimer = setTimeout(() => this.#settleZoom(context), ZOOM_SETTLE_MS);
    else this.#settleZoom(context);
  }
  #settleZoom(context: object) {
    if (this.#zoomSettleTimer) clearTimeout(this.#zoomSettleTimer);
    this.#zoomSettleTimer = 0;
    const wasLive = this.#zoomLive;
    this.#zoomLive = false;
    if (!wasLive) return;
    // Raster what the reader now sees, then rewarm the neighbours.
    if (this.scrolled) this.#rezoomStack(context);
    else {
      this.#render(this.#side, context);
      this.#schedulePreload(context);
    }
  }
  #eachLiveFrame(fn: (frame: FixedFrame) => void) {
    for (const frames of this.#liveFrames.values()) this.#eachFrame(frames, fn);
    for (const entry of this.#stack ?? []) if (entry.frame) fn(entry.frame);
  }
  // A zoom holds a page point still: the point's place within the box it
  // falls in — one page's slot in a stack, the whole spread when paged — is
  // read before the zoom and scrolled back under the anchor after it.
  #zoomBox(slot: HTMLElement | null): DOMRect | null {
    return slot ? slot.getBoundingClientRect() : this.#spreadBox();
  }
  #captureZoomAnchor(anchor?: ZoomAnchor): ZoomHold | null {
    const host = this.getBoundingClientRect();
    const point = anchor ?? { x: host.left + this.clientWidth / 2, y: host.top + this.clientHeight / 2 };
    let slot: HTMLElement | null = null;
    if (this.scrolled) {
      if (!this.#stack?.length) return null;
      slot = this.#stack[this.#stackIndexAt(this.scrollTop + point.y - host.top)]?.slot ?? null;
      if (!slot) return null;
    }
    const box = this.#zoomBox(slot);
    if (!box?.width || !box.height) return null;
    return { point, fx: (point.x - box.left) / box.width, fy: (point.y - box.top) / box.height, slot };
  }
  #restoreZoomAnchor(held: ZoomHold | null) {
    if (!held) return;
    const box = this.#zoomBox(held.slot);
    if (!box) return;
    this.scrollLeft += box.left + held.fx * box.width - held.point.x;
    this.scrollTop += box.top + held.fy * box.height - held.point.y;
    if (this.scrolled) this.#stackScrollFeedback = { position: this.scrollTop, context: this.#positionContext };
  }
  /** Client box of the paged spread on screen. */
  #spreadBox(): DOMRect | null {
    let box: DOMRect | null = null;
    for (const frame of [this.#left, this.#center, this.#right]) {
      if (!frame || frame.hidden || frame.element.style.display === "none") continue;
      const rect = frame.element.getBoundingClientRect();
      box = box
        ? new DOMRect(
            Math.min(box.left, rect.left),
            Math.min(box.top, rect.top),
            Math.max(box.right, rect.right) - Math.min(box.left, rect.left),
            Math.max(box.bottom, rect.bottom) - Math.min(box.top, rect.top),
          )
        : rect;
    }
    return box;
  }
  // READAWARE: where the viewport's center sits relative to the page being
  // read (`index`), as fractions of that page's box — outside 0–1 when the
  // center falls beside it, as between a spread's pages. A reading position
  // names only the page; this is the rest of what the reader was looking
  // at, so a zoomed page can reopen on the same passage.
  /** The viewport's center relative to the page being read, or null before a page shows. */
  get viewFocus(): ViewFocus | null {
    // A stack reads its current page from the scroll position itself — the
    // window's own record trails a scroll by a throttle step.
    const spread =
      this.scrolled && this.#stack?.length
        ? this.#spreads[this.#stackIndexAt(this.scrollTop + this.clientHeight / 2)]
        : null;
    const section = spread ? (spread.center ?? spread.left ?? spread.right) : null;
    const index = section && this.book ? this.book.sections.indexOf(section) : this.index;
    const box = this.#pageBox(index);
    if (!box?.width || !box.height) return null;
    const host = this.getBoundingClientRect();
    return {
      index,
      x: (host.left + this.clientWidth / 2 - box.left) / box.width,
      y: (host.top + this.clientHeight / 2 - box.top) / box.height,
    };
  }
  /** Scroll `focus` back to the viewport's center; false when its page is not the one shown. */
  showFocus(focus: ViewFocus): boolean {
    if (focus.index !== this.index) return false;
    const box = this.#pageBox(focus.index);
    if (!box?.width || !box.height) return false;
    const host = this.getBoundingClientRect();
    this.scrollLeft += box.left + focus.x * box.width - (host.left + this.clientWidth / 2);
    this.scrollTop += box.top + focus.y * box.height - (host.top + this.clientHeight / 2);
    if (this.scrolled) this.#stackScrollFeedback = { position: this.scrollTop, context: this.#positionContext };
    return true;
  }
  /** Client box of section `index`'s page: its stack slot, or its frame in the shown spread. */
  #pageBox(index: number): DOMRect | null {
    const section = this.book?.sections[index];
    if (!section) return null;
    if (this.scrolled) {
      const spread = this.getSpreadOf(section);
      return spread ? (this.#stack?.[spread.index]?.slot.getBoundingClientRect() ?? null) : null;
    }
    const frame = [this.#left, this.#center, this.#right].find((frame) => frame?.index === index && !frame.hidden);
    return frame?.element.getBoundingClientRect() ?? null;
  }
  // READAWARE: a locked view (paged flows only). The reader froze a zoomed
  // spread on the part of the page they read, so every page turned to shows
  // that same part: nothing pans it — not the wheel, a drag, a key or a
  // swipe, all of which turn pages as at the fit — and a page turn keeps the
  // scroll position rather than opening at the page's start. A zoom still
  // moves it (programmatic scrolling survives `overflow: hidden`), and the
  // view stays locked at the new zoom. A continuous scroll has no lock: it is
  // read by scrolling.
  get viewLocked() {
    return this.#viewLocked;
  }
  setViewLocked(locked: boolean) {
    this.#viewLocked = locked;
    this.toggleAttribute("view-locked", locked);
  }
  // READAWARE: a zoomed paged spread is panned inside the viewport. The
  // host scrolls natively, but the reader claims the wheel in paged flows to
  // turn pages, so it asks here first: a pan that moves the spread wins.
  /** Pan a zoomed paged spread; true when it moved. Scrolled flows scroll natively; a locked view never pans. */
  panBy(dx: number, dy: number): boolean {
    if (this.scrolled || this.#viewLocked) return false;
    const { scrollLeft, scrollTop } = this;
    this.scrollLeft = scrollLeft + dx;
    this.scrollTop = scrollTop + dy;
    return this.scrollLeft !== scrollLeft || this.scrollTop !== scrollTop;
  }
  /** Which edges of a paged spread the viewport rests against — all four when it fits, or is locked. */
  get panEdges(): PanEdges {
    if (this.#viewLocked && !this.scrolled) return { left: true, top: true, right: true, bottom: true };
    const slack = 1;
    return {
      left: this.scrollLeft <= slack,
      top: this.scrollTop <= slack,
      right: this.scrollLeft + this.clientWidth >= this.scrollWidth - slack,
      bottom: this.scrollTop + this.clientHeight >= this.scrollHeight - slack,
    };
  }
  /** Show a newly turned-to spread from its reading start, or — turning back — its end. */
  #revealEdge(edge: PageEdge) {
    // A locked view keeps showing the same part of every page.
    if (this.scrolled || this.#viewLocked) return;
    const start = edge === "start";
    const inlineStart = this.rtl ? this.scrollWidth : 0;
    const inlineEnd = this.rtl ? 0 : this.scrollWidth;
    this.scrollTop = start ? 0 : this.scrollHeight;
    this.scrollLeft = start ? inlineStart : inlineEnd;
  }
  // READAWARE: keep each zoomed page's sharp overlay over what is on screen
  // (see pdf-detail.ts), once the viewport has paused.
  #scheduleDetail() {
    if (this.#detailTimer) clearTimeout(this.#detailTimer);
    this.#detailTimer = setTimeout(() => {
      this.#detailTimer = 0;
      this.#refreshDetail();
    }, DETAIL_SETTLE_MS);
  }
  #refreshDetail() {
    if (this.#zoomLive) return;
    const host = this.getBoundingClientRect();
    const view = {
      left: host.left,
      top: host.top,
      right: host.left + this.clientWidth,
      bottom: host.top + this.clientHeight,
    };
    this.#eachLiveFrame((frame) => {
      if (!frame.doc || !frame.onDetail || frame.renderedScale == null) return;
      // Only a frame rastered at the scale it is shown at can be sharpened;
      // one mid-raster schedules this again when it finishes.
      if (frame.renderingScale != null) return;
      const rect = frame.element.getBoundingClientRect();
      const shown = !frame.hidden && frame.element.style.display !== "none" && rect.width > 0 && rect.height > 0;
      const left = Math.max(rect.left, view.left);
      const top = Math.max(rect.top, view.top);
      const right = Math.min(rect.right, view.right);
      const bottom = Math.min(rect.bottom, view.bottom);
      const visible =
        shown && right > left && bottom > top
          ? {
              left: (left - rect.left) / rect.width,
              top: (top - rect.top) / rect.height,
              right: (right - rect.left) / rect.width,
              bottom: (bottom - rect.top) / rect.height,
            }
          : null;
      this.#cancelFrameDetail(frame);
      const controller = new AbortController();
      frame.detailAbort = controller;
      frame
        .onDetail({
          doc: frame.doc,
          scale: frame.renderedScale,
          pageColors: this.#pageColors,
          signal: controller.signal,
          visible,
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "RenderCancelledError") return;
          console.error(error);
        })
        .finally(() => {
          if (frame.detailAbort === controller) frame.detailAbort = null;
        });
    });
  }
  #onResize(context = this.#positionContext) {
    this.#positionContext = context;
    if (this.scrolled && this.#stack) {
      // Keep the reading position anchored while every slot resizes.
      const entry = this.#stack[this.#stackCurrent];
      const offset = entry ? (this.scrollTop - entry.top) / Math.max(1, entry.pixelHeight) : 0;
      this.#layoutStack(context, false);
      if (entry) this.#setStackScroll(entry.top + offset * entry.pixelHeight, this.#positionContext);
      this.#updateStackWindow("layout", context);
      return;
    }
    this.#render(this.#side, context);
  }
  #clearFrameCache() {
    this.#navigation++;
    this.#displayedIndex = -1;
    this.#stackScrollFeedback = undefined;
    this.#positionContext = {};
    if (this.#stackScrollTimer) {
      clearTimeout(this.#stackScrollTimer);
      this.#stackScrollTimer = 0;
    }
    // A live zoom's deferred raster and the detail pass belong to the
    // frames being dropped; the new layout rasters at the zoom as it stands.
    if (this.#zoomSettleTimer) clearTimeout(this.#zoomSettleTimer);
    this.#zoomSettleTimer = 0;
    this.#zoomLive = false;
    if (this.#detailTimer) clearTimeout(this.#detailTimer);
    this.#detailTimer = 0;
    this.#frameGeneration++;
    this.#preloadToken++;
    for (const frames of this.#liveFrames.values())
      this.#eachFrame(frames, (frame) => {
        this.#cancelFrameRender(frame);
        frame.element.remove();
      });
    this.#liveFrames.clear();
    this.#framePromises.clear();
    this.#lru = [];
    this.#left = null;
    this.#right = null;
    this.#center = null;
    this.#teardownStack();
    this.#stackDefaultDims = null;
    this.#root.replaceChildren();
  }
  #goLeft(context: object, edge: PageEdge) {
    if (this.#center || this.#left?.blank) return;
    if (this.#portrait && this.#left?.element?.style?.display === "none") {
      this.#side = "left";
      this.#render(this.#side, context);
      this.#revealEdge(edge);
      this.#reportLocation("page", null, context);
      return true;
    }
  }
  #goRight(context: object, edge: PageEdge) {
    if (this.#center || this.#right?.blank) return;
    if (this.#portrait && this.#right?.element?.style?.display === "none") {
      this.#side = "right";
      this.#render(this.#side, context);
      this.#revealEdge(edge);
      this.#reportLocation("page", null, context);
      return true;
    }
  }
  open(book: Book) {
    this.book = book;
    const { rendition } = book;
    this.defaultViewport = rendition?.viewport;

    const rtl = book.dir === "rtl";
    this.rtl = rtl;

    this.#buildSpreads();
    if (this.scrolled) this.#buildStack();
  }
  #buildSpreads() {
    if (!this.book) return;
    const { rendition } = this.book;
    const maxColumnCount = this.#maxColumnCount ?? parseInt(this.getAttribute("max-column-count") ?? "");
    const singlePage = this.scrolled || maxColumnCount === 1 || (!maxColumnCount && rendition?.spread === "none");
    this.spread = singlePage ? "none" : rendition?.spread === "none" ? undefined : rendition?.spread;

    const rtl = this.rtl;
    const ltr = !rtl;

    if (singlePage) this.#spreads = this.book.sections.map((section) => ({ center: section }));
    else
      this.#spreads = this.book.sections.reduce<FixedSpread[]>(
        (arr, section, i) => {
          const last = arr[arr.length - 1];
          const { pageSpread } = section;
          const newSpread = () => {
            const spread: FixedSpread = {};
            arr.push(spread);
            return spread;
          };
          if (pageSpread === "center") {
            const spread = last.left || last.right ? newSpread() : last;
            spread.center = section;
          } else if (pageSpread === "left") {
            const spread = last.center || last.left || (ltr && i) ? newSpread() : last;
            spread.left = section;
          } else if (pageSpread === "right") {
            const spread = last.center || last.right || (rtl && i) ? newSpread() : last;
            spread.right = section;
          } else if (ltr) {
            if (last.center || last.right) newSpread().left = section;
            else if (last.left || !i) last.right = section;
            else last.left = section;
          } else {
            if (last.center || last.left) newSpread().right = section;
            else if (last.right || !i) last.left = section;
            else last.right = section;
          }
          return arr;
        },
        [{}],
      );
  }
  #rebuildSpreads(context: object = {}) {
    if (!this.book) return;
    const currentIndex = this.index;
    this.#buildSpreads();
    // READAWARE: the spread composition (or the flow) changed, so every
    // cached frame belongs to a layout that no longer exists.
    this.#clearFrameCache();
    if (this.scrolled) this.#buildStack();
    this.#index = -1;
    if (currentIndex >= 0) void this.goTo({ index: currentIndex, context });
  }
  // READAWARE: page colors for lazily rendered frames (PDF), as
  // `{ background, foreground? }` — see pdf.js for what each one means — or
  // null to render the page as authored. Baked into the render, so a change
  // invalidates every live frame's cached scale to force a redraw — cached
  // hidden spreads included, or turning a page after a palette change would
  // flash the old colors.
  setPageColors(pageColors: PageColors, context: object = {}) {
    const next = pageColors?.background ? pageColors : null;
    if (next?.background === this.#pageColors?.background && next?.foreground === this.#pageColors?.foreground) return;
    this.#pageColors = next;
    this.#positionContext = context;
    for (const frames of this.#liveFrames.values())
      this.#eachFrame(frames, (frame) => {
        this.#cancelFrameRender(frame);
        frame.renderedScale = null;
      });
    if (this.#stack) {
      const viewport = this.#stackViewport();
      for (const entry of this.#stack) {
        if (entry.frame) {
          this.#cancelFrameRender(entry.frame);
          entry.frame.renderedScale = null;
        }
        this.#sizeSlot(entry, viewport);
      }
    }
    this.#render();
    // Repaint the warm window in the new colors behind the visible page.
    if (!this.scrolled) this.#schedulePreload();
  }
  setLayout(flow: string, maxColumnCount: number, context: object = {}) {
    if (this.#flow === flow && this.#maxColumnCount === maxColumnCount) return;
    this.#flow = flow;
    this.#maxColumnCount = maxColumnCount;
    this.setAttribute("flow", flow);
    this.setAttribute("max-column-count", String(maxColumnCount));
    this.#rebuildSpreads(context);
  }
  get scrolled() {
    return (this.#flow ?? this.getAttribute("flow")) === "scrolled";
  }
  get start() {
    return this.scrollTop;
  }
  get end() {
    return this.scrollTop + this.clientHeight;
  }
  get viewSize() {
    return this.scrollHeight;
  }
  get index() {
    const spread = this.#spreads?.[this.#index];
    if (!spread) return -1;
    const section =
      spread.center ?? (this.#side === "left" ? (spread.left ?? spread.right) : (spread.right ?? spread.left));
    return section && this.book ? this.book.sections.indexOf(section) : -1;
  }
  #reportLocation(reason: RelocateReason, range: Range | null, context: object) {
    this.#positionContext = context;
    this.dispatchEvent(
      new CustomEvent("relocate", { detail: { reason, range, index: this.index, fraction: 0, size: 1, context } }),
    );
  }
  getSpreadOf(section: BookSection): { index: number; side: Side } | undefined {
    const spreads = this.#spreads;
    for (let index = 0; index < spreads.length; index++) {
      const { left, right, center } = spreads[index];
      if (left === section) return { index, side: "left" };
      if (right === section) return { index, side: "right" };
      if (center === section) return { index, side: "center" };
    }
  }
  goToSpread(index: number, side: Side, reason: RelocateReason = "navigation", context: object = {}) {
    return this.#goToSpread(index, side, reason, context, ++this.#navigation);
  }
  async #goToSpread(
    index: number,
    side: Side,
    reason: RelocateReason,
    context: object,
    navigation: number,
    edge: PageEdge = "start",
  ) {
    if (index < 0 || index > this.#spreads.length - 1) return;
    if (this.scrolled) return this.#goToStack(index, reason, context);
    if (index === this.#index && index === this.#displayedIndex) {
      this.#side = side;
      this.#render(side, context);
      this.#reportLocation(reason, null, context);
      return;
    }
    this.#index = index;
    const frames = await this.#framesFor(index, context);
    // READAWARE: a newer navigation landed while the frames were loading —
    // it owns the display now.
    if (this.#index !== index || this.#navigation !== navigation) return;
    this.#displayedIndex = index;
    this.#showFrames(frames, side, context);
    // A zoomed spread opens where reading it begins — or, turned back to,
    // where it ends.
    this.#revealEdge(edge);
    if (this.#navigation !== navigation) return;
    this.#reportLocation(reason, null, context);
    this.#touchLRU(index);
    this.#evict();
    this.#schedulePreload(context);
  }
  select(target: MaybePromise<ResolvedNavigation | null | undefined>) {
    return this.goTo(Promise.resolve(target).then((resolved) => (resolved ? { ...resolved, select: true } : resolved)));
  }
  async goTo(target: MaybePromise<ResolvedNavigation | null | undefined>) {
    const { book } = this;
    const navigation = ++this.#navigation;
    const resolved = await target;
    if (!book || !resolved || this.book !== book || this.#navigation !== navigation) return;
    const section = book.sections[resolved.index];
    if (!section) return;
    const spread = this.getSpreadOf(section);
    if (!spread) return;
    const { index, side } = spread;
    const context = resolved.context ?? {};
    // WKWebView may not have applied the newly connected host's shadow
    // stylesheet yet. Scrolling then clamps to zero and overwrites a saved
    // page with page one. Let the first layout establish a scroll viewport
    // before positioning the stack; a replaced navigation must stay retired.
    if (this.scrolled && (!this.clientWidth || !this.clientHeight)) {
      do {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (book !== this.book || this.#navigation !== navigation) return;
      } while (!this.clientWidth || !this.clientHeight);
      this.#layoutStack(context);
    }
    await this.#goToSpread(index, side, "navigation", context, navigation);
    if (book !== this.book || this.#navigation !== navigation) return;
    const content = this.getContents().find((content) => content.index === resolved.index);
    if (content) {
      const anchor = anchorValue(content.doc, resolved.anchor);
      if (anchor != null) await this.scrollToAnchor(anchor, resolved.select, context);
    }
  }
  async scrollToAnchor(anchor: Anchor, select = false, context: object = {}) {
    if (typeof anchor === "number") return;
    const doc = isRange(anchor) ? anchor.startContainer.ownerDocument : anchor.ownerDocument;
    if (!doc || !this.getContents().some((content) => content.doc === doc)) return;
    if (select) {
      const range = anchorRange(doc, anchor),
        selection = doc.defaultView?.getSelection();
      if (range && selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    anchorElement(anchor)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (this.scrolled) this.#stackScrollFeedback = { position: this.scrollTop, context };
    this.#reportLocation("navigation", anchorRange(doc, anchor), context);
  }
  async next(_distance?: number, context: object = {}) {
    const navigation = ++this.#navigation;
    if (this.scrolled) return this.#goToStack(this.#stackCurrent + 1, "page", context);
    const s = this.rtl ? this.#goLeft(context, "start") : this.#goRight(context, "start");
    if (!s) await this.#goToSpread(this.#index + 1, this.rtl ? "right" : "left", "page", context, navigation, "start");
  }
  async prev(_distance?: number, context: object = {}) {
    const navigation = ++this.#navigation;
    if (this.scrolled) return this.#goToStack(this.#stackCurrent - 1, "page", context);
    const s = this.rtl ? this.#goRight(context, "end") : this.#goLeft(context, "end");
    if (!s) await this.#goToSpread(this.#index - 1, this.rtl ? "left" : "right", "page", context, navigation, "end");
  }
  /** Wait for the displayed page, not background preloads or the iframe load. */
  async waitForCurrentRender(): Promise<void> {
    const generation = this.#frameGeneration,
      index = this.#index;
    const frames = this.scrolled
      ? [this.#stack?.[this.#stackCurrent]?.frame]
      : [this.#left, this.#right, this.#center].filter((frame) => frame?.element.style.display !== "none");
    if (!frames.some((frame) => frame?.doc)) throw new Error("Reading page has no loaded frame");
    for (const frame of frames) {
      if (!frame?.onZoom) continue;
      for (;;) {
        const pending = frame.renderPromise;
        await pending;
        if (generation !== this.#frameGeneration || index !== this.#index)
          throw new Error("Reading page was replaced before paint completed");
        if (pending !== frame.renderPromise) continue;
        if (frame.renderError) throw frame.renderError;
        if (frame.renderedScale == null) throw new Error("Reading page has not rendered");
        break;
      }
    }
  }
  // READAWARE: report the frames themselves rather than raw iframes, so the
  // view can find the section index and overlayer an annotation belongs to.
  // The page being read comes first — `getContents()[0]` is "the current
  // page" to consumers — followed by the other live frames, so annotation
  // edits reach warm cached pages too.
  getContents(): Content[] {
    if (this.scrolled && this.#stack) {
      const current = this.#stackCurrent;
      return this.#stack
        .flatMap((entry, i) =>
          entry.frame?.doc
            ? [
                {
                  doc: entry.frame.doc,
                  index: entry.frame.index,
                  overlayer: entry.frame.overlayer,
                  distance: Math.abs(i - current),
                },
              ]
            : [],
        )
        .sort((a, b) => a.distance - b.distance)
        .map(({ doc, index, overlayer }) => ({ doc, index, overlayer }));
    }
    const current = [this.#left, this.#right, this.#center].filter((frame): frame is FixedFrame => !!frame?.doc);
    const seen = new Set(current);
    const cached: FixedFrame[] = [];
    for (const frames of this.#liveFrames.values())
      this.#eachFrame(frames, (frame) => {
        if (frame.doc && !seen.has(frame)) cached.push(frame);
      });
    return [...current, ...cached].flatMap(({ doc, index, overlayer }) => (doc ? [{ doc, index, overlayer }] : []));
  }
  destroy() {
    this.#observer.disconnect();
    this.inputBridge = undefined;
    this.removeEventListener("scroll", this.#onStackScroll);
    this.removeEventListener("scroll", this.#onScrollDetail);
    this.#clearFrameCache();
  }
}

customElements.define("foliate-fxl", FixedLayout);
