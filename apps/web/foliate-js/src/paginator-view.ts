import type { Overlayer } from "./overlayer.js";
import { getDirection, getBackground, setStylesImportant } from "./paginator-geometry.js";
import { imageBlockSpacing, isImageOnlyDocument, type BlockSpacing } from "./paginator-media.js";
import type { Anchor, ResolvedNavigation } from "./book.js";
import { ChapterRanges } from "./paginator-chapters.js";
import { fitWideContent, flowBody } from "./paginator-fit.js";
import { LayoutWindow } from "./paginator-window.js";
import type { RectMapper } from "./paginator-geometry.js";

export type Layout = {
  width: number;
  height: number;
  margin: number;
  gap: number;
  columnWidth: number;
  flow?: string | null;
};

export type BeforeRender = { vertical: boolean; rtl: boolean; background?: string };

// How much of a long document is laid out at once (see LayoutWindow), in
// screenfuls of text. A screenful is weighed as glyphs half an em wide on
// lines 1.2 em tall, which is tighter than any book is set: real text takes
// more room, so each of these reaches further than it says.
/** A document lighter than this is laid out whole. */
const WINDOW_LEAST = 12;
/** Laid out past the place the reader is taken to, and before it where the flow allows. */
const WINDOW_AHEAD = 2;
const WINDOW_BEHIND = 1;
/** What joins the window at a time while the reader is elsewhere. */
const WINDOW_BATCH = 2;
/** In columns every batch lays the earlier pages out again, so batches grow with what is laid out. */
const WINDOW_BATCH_SHARE = 0.25;

/** A slow or broken font must not hold the page: past this, the section
    reveals in its fallback and swaps late, exactly as before. */
export const FONT_REVEAL_TIMEOUT_MS = 1000;

/**
 * Resolves when `doc.fonts.ready` settles or the timeout elapses, whichever
 * comes first. Never rejects — a failed face means fallback text, not a
 * failed load.
 */
export function waitForDocumentFonts(doc: Document, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    doc.fonts.ready.then(done, done);
  });
}

export class SectionView {
  readonly container: HTMLElement;
  readonly onExpand: () => void;

  // An observer's first report is the size it starts from, which the layout
  // pass has just measured: only a size that differs from it is an expansion.
  // So is the report that follows the view's own growth (see #join).
  #observed = false;
  #measuredSinceReport = false;
  #observer = new ResizeObserver(() => {
    const measured = !this.#observed || this.#measuredSinceReport;
    this.#observed = true;
    this.#measuredSinceReport = false;
    this.expand(measured);
  });
  #element = document.createElement("div");
  #iframe = document.createElement("iframe");
  #contentRange = document.createRange();
  #overlayer: Overlayer | undefined;
  #vertical = false;
  #rtl = false;
  #column = true;
  #size = 0;
  #layout: Layout | undefined;
  #destroyed = false;
  #cancelLoad: (() => void) | undefined;
  #chapters: ChapterRanges | undefined;
  /** The document this view finished loading; until then the iframe's may be a half-parsed one. */
  #loaded: Document | null = null;
  /** The font batch whose arrival repeats the layout pass. */
  #fontsAwaited: Promise<unknown> | undefined;
  /** The place this view was loaded to show; its layout window opens around it. */
  #openingAt: Anchor | undefined;
  /** The part of a long document that is laid out so far; undefined when that is all of it. */
  #window: LayoutWindow | undefined;
  /** The weight of one screenful of text, as the window counts it. */
  #screenful = 0;
  // Source geometry stays independent of the visible chapter's extent.
  // contentSize excludes padding; fullSize includes the reader's margins.
  #contentSize = 0;
  #contentOffset = 0;
  #fullSize = 0;
  #chapterOffsets: number[] = [0];
  #firstPart = true;
  #lastPart = true;
  readonly chapterStarts: readonly ResolvedNavigation[];
  constructor({
    container,
    onExpand,
    chapterStarts = [],
  }: { container: HTMLElement; onExpand: () => void; chapterStarts?: readonly ResolvedNavigation[] }) {
    this.container = container;
    this.onExpand = onExpand;
    this.chapterStarts = chapterStarts;
    this.#iframe.setAttribute("part", "filter");
    this.#element.append(this.#iframe);
    Object.assign(this.#element.style, {
      boxSizing: "content-box",
      position: "relative",
      overflow: "hidden",
      flex: "0 0 auto",
      width: "100%",
      height: "100%",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
    });
    Object.assign(this.#iframe.style, {
      overflow: "hidden",
      border: "0",
      display: "none",
      flex: "0 0 auto",
      width: "100%",
      height: "100%",
    });
    // `allow-scripts` is needed for events because of WebKit bug
    // https://bugs.webkit.org/show_bug.cgi?id=218086
    this.#iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");
    this.#iframe.setAttribute("scrolling", "no");
  }
  get element() {
    return this.#element;
  }
  /** The loaded section document; null while the iframe still holds a half-parsed or earlier one. */
  get document() {
    const doc = this.#iframe.contentDocument;
    return doc && doc === this.#loaded ? doc : null;
  }
  get ready() {
    return !this.#destroyed && this.#layout !== undefined;
  }
  get isScrolled() {
    return !this.#column;
  }
  /**
   * Load a section document and lay it out. `openAt` names the place the
   * reader is being taken to: a long document is laid out around it first and
   * completed afterwards (see `LayoutWindow`). Without it the document is
   * laid out whole.
   */
  async load(
    src: string,
    afterLoad?: (doc: Document) => void,
    beforeRender?: (input: BeforeRender) => Layout,
    openAt?: (doc: Document) => Anchor | undefined,
  ) {
    if (typeof src !== "string") throw new TypeError(`Expected a string source, got ${typeof src}`);
    if (this.#destroyed) throw new DOMException("Page view was destroyed", "AbortError");
    return new Promise<void>((resolve, reject) => {
      let cancelled = false;
      const removeListeners = () => {
        this.#iframe.removeEventListener("load", onLoad);
        this.#iframe.removeEventListener("error", onError);
      };
      const cleanup = () => {
        this.#cancelLoad = undefined;
        removeListeners();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Could not load page document"));
      };
      const onLoad = () => {
        // The document is here — drop the listeners now. The cancel hook
        // stays armed through the font wait below.
        removeListeners();
        try {
          const doc = this.#iframe.contentDocument;
          if (!doc) throw new Error("Page document is inaccessible");
          if (!doc.body) throw new Error("Page document has no body");
          this.#loaded = doc;
          // In the layout tree from here on, and revealed only once the fonts
          // its text uses have arrived. visibility, not display: styles are
          // computed and the page is laid out exactly once on the way there,
          // and that layout is what starts the face loads.
          this.#iframe.style.visibility = "hidden";
          this.#iframe.style.display = "block";
          doc.documentElement.toggleAttribute("data-foliate-image-page", isImageOnlyDocument(doc));
          afterLoad?.(doc);
          this.#chapters = new ChapterRanges(doc, this.chapterStarts);
          this.#openingAt = openAt?.(doc);

          const { vertical, rtl } = getDirection(doc);
          const background = getBackground(doc);
          this.#vertical = vertical;
          this.#rtl = rtl;
          this.#contentRange.selectNodeContents(doc.body);
          this.render(beforeRender?.({ vertical, rtl, background }));
          this.#observer.observe(doc.body);

          void waitForDocumentFonts(doc, FONT_REVEAL_TIMEOUT_MS).then(() => {
            // A superseded or destroyed load must not reveal or resolve.
            if (cancelled || this.#destroyed || this.#iframe.contentDocument !== doc) return;
            this.#iframe.style.visibility = "";
            this.#cancelLoad = undefined;
            resolve();
          });
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      this.#cancelLoad = () => {
        cancelled = true;
        this.#iframe.style.visibility = "";
        cleanup();
        reject(new DOMException("Page load was cancelled", "AbortError"));
      };
      this.#iframe.addEventListener("load", onLoad, { once: true });
      this.#iframe.addEventListener("error", onError, { once: true });
      this.#iframe.src = src;
    });
  }
  render(layout: Layout | undefined) {
    if (!layout) return;
    // READAWARE: a view whose document is not loaded yet (the iframe may
    // hold a half-parsed document without a body while a resize arrives)
    // or no longer (torn down while the next book opens) has nothing to lay
    // out; the load path renders once its document is complete.
    if (this.#destroyed || !this.document) return;
    this.#column = layout.flow !== "scrolled";
    this.#layout = layout;
    // Columns fill in order: a window opened in scrolled flow may have left
    // the document's start out, and every page depends on it.
    if (this.#column && this.#window?.waitingBefore) {
      this.#window.grow(-1, Infinity);
      if (this.#window.complete) this.#window = undefined;
    }
    if (this.#column) this.columnize(layout);
    else this.scrolled(layout);
  }
  scrolled({ gap, columnWidth }: Layout) {
    const vertical = this.#vertical;
    const doc = this.document;
    if (!doc) return;
    flowBody(doc);
    setStylesImportant(doc.documentElement, {
      "box-sizing": "border-box",
      padding: vertical ? `${gap}px 0` : `0 ${gap}px`,
      "column-width": "auto",
      height: "auto",
      width: "auto",
    });
    setStylesImportant(doc.body, {
      [vertical ? "max-height" : "max-width"]: `${columnWidth}px`,
      margin: "auto",
    });
    this.#layOut(doc);
  }
  columnize({ width, height, gap, columnWidth }: Layout) {
    const vertical = this.#vertical;
    this.#size = vertical ? height : width;

    const doc = this.document;
    if (!doc) return;
    this.#element.style.margin = "0";
    flowBody(doc);
    setStylesImportant(doc.documentElement, {
      "box-sizing": "border-box",
      "column-width": `${Math.trunc(columnWidth)}px`,
      "column-gap": `${gap}px`,
      "column-fill": "auto",
      // Both extents, before the first layout: the frame grows to hold every
      // page once they are counted, and a root sized by that frame would be
      // laid out a second time for it.
      width: `${width}px`,
      height: `${height}px`,
      padding: vertical ? `${gap / 2}px 0` : `0 ${gap / 2}px`,
      overflow: "hidden",
      // force wrap long words
      "overflow-wrap": "break-word",
      // reset some potentially problematic props
      position: "static",
      border: "0",
      margin: "0",
      "max-height": "none",
      "max-width": "none",
      "min-height": "none",
      "min-width": "none",
      // fix glyph clipping in WebKit
      "-webkit-line-box-contain": "block glyphs replaced",
    });
    setStylesImportant(doc.body, {
      "max-height": "none",
      "max-width": "none",
      margin: "0",
    });
    this.#layOut(doc);
  }
  /**
   * One pass over a document whose flow styles are set: bound its media, fit
   * what is wider than the column, then measure. Each step reads everything
   * it needs before it writes anything, so the document is laid out once for
   * the fit and at most once more when the fit changed something.
   */
  #layOut(doc: Document) {
    this.#openWindow(doc);
    this.setImageSize();
    fitWideContent(doc);
    this.expand();
    this.#refitWhenFontsArrive(doc);
  }
  /** Before a loaded document's first layout: keep what is far from the opening place out of it. */
  #openWindow(doc: Document) {
    const at = this.#openingAt;
    this.#openingAt = undefined;
    const layout = this.#layout;
    if (at === undefined || !layout || !doc.defaultView) return;
    // A fraction addresses the laid-out extent, so it needs all of it; only
    // the two ends are places in the document itself.
    if (typeof at === "number" && at > 0 && at < 1) return;
    const fontSize = parseFloat(doc.defaultView.getComputedStyle(doc.body).fontSize) || 16;
    const screenful = (layout.width * layout.height) / (0.6 * fontSize * fontSize);
    const window = LayoutWindow.over(doc, screenful * WINDOW_LEAST);
    if (!window) return;
    const node = typeof at === "number" ? null : "startContainer" in at ? at.startContainer : at;
    // Entered at its end, a paginated document needs every page before the last.
    if (this.#column && at === 1) return;
    window.open(
      node ? window.indexOf(node) : at === 1 ? Infinity : 0,
      this.#column ? Infinity : at === 0 ? 0 : screenful * (at === 1 ? WINDOW_AHEAD : WINDOW_BEHIND),
      at === 1 ? 0 : screenful * WINDOW_AHEAD,
    );
    if (window.complete) return;
    this.#window = window;
    this.#screenful = screenful;
  }
  /** Whether part of the document is still to be laid out. */
  get windowed() {
    return this.#window !== undefined;
  }
  /**
   * Whether the selected chapter has content before (`dir` -1) or after (1)
   * what is laid out. The view's edge on that side is then not the chapter's.
   */
  hasDeferred(dir: -1 | 1): boolean {
    const window = this.#window;
    if (!window) return false;
    const starts = this.#chapters?.starts ?? [null];
    const index = this.#chapters?.index ?? 0;
    return dir < 0 ? window.waitsBefore(starts[index] ?? undefined) : window.waitsAfter(starts[index + 1] ?? undefined);
  }
  /** The first laid-out block while content before it is deferred: what moves when that content joins. */
  get windowStart(): Element | undefined {
    return this.#window?.waitingBefore ? this.#window.first : undefined;
  }
  /**
   * Lay out one more batch of the document after (`dir` 1) or before (-1)
   * what is laid out, or on whichever side is waiting when `dir` is omitted
   * (the reading direction first). False when nothing was waiting there.
   */
  grow(dir?: -1 | 1): boolean {
    const window = this.#window;
    if (!window) return false;
    const side = dir ?? (window.waitingAfter ? 1 : -1);
    const batch = this.#column
      ? Math.max(this.#screenful * WINDOW_BATCH, window.laidOut * WINDOW_BATCH_SHARE)
      : this.#screenful * WINDOW_BATCH;
    return this.#join(window.grow(side, batch));
  }
  /**
   * Lay out one more batch when what is laid out ends between the flow
   * positions `from` and `to`, as `mapRect` places the document's rects.
   * Returns whether a batch joined: the caller asks again until none does,
   * since a batch joining before the viewport moves the positions it asks about.
   */
  cover(from: number, to: number, mapRect: RectMapper): boolean {
    const window = this.#window;
    if (!window) return false;
    const { first, last } = window;
    if (window.waitingAfter && last && mapRect(last.getBoundingClientRect()).right < to) return this.grow(1);
    if (window.waitingBefore && first && mapRect(first.getBoundingClientRect()).left > from) return this.grow(-1);
    return false;
  }
  /**
   * Lay out the place `anchor` names before it is measured: a node or range,
   * or a fraction of the selected chapter (what `selectChapter` returns).
   */
  reveal(anchor: Anchor): boolean {
    const window = this.#window;
    if (!window) return false;
    if (typeof anchor !== "number") {
      const node = "startContainer" in anchor ? anchor.startContainer : anchor;
      return this.#join(window.growTo(window.indexOf(node), this.#screenful * WINDOW_AHEAD));
    }
    if (anchor > 0 && anchor < 1) return this.layOutAll();
    const range = this.#chapters?.ranges[this.#chapters.index];
    if (!range) return this.#join(anchor >= 1 ? window.growToAll() : window.growTo(0, this.#screenful * WINDOW_AHEAD));
    // The chapter's first node, or its last: a boundary point names the node after it.
    const edge =
      anchor >= 1
        ? (range.endContainer.childNodes[range.endOffset - 1] ?? range.endContainer)
        : (range.startContainer.childNodes[range.startOffset] ?? range.startContainer);
    return this.#join(window.growTo(window.indexOf(edge), this.#screenful * WINDOW_AHEAD));
  }
  /** Lay out everything that is still deferred. */
  layOutAll(): boolean {
    return this.#window ? this.#join(this.#window.growToAll()) : false;
  }
  /** Content joined the layout: fit it like the rest, and measure the document again. */
  #join(joined: Element[]): boolean {
    const doc = this.document;
    if (!joined.length || !doc) return false;
    if (this.#window?.complete) this.#window = undefined;
    fitWideContent(doc, joined);
    // The observer reports this growth on the next frame; it is measured here.
    this.#measuredSinceReport = true;
    this.expand();
    return true;
  }
  /** Faces still loading after a pass change the text's metrics when they
   * arrive: the pass is repeated then, once per batch of faces. */
  #refitWhenFontsArrive(doc: Document) {
    const ready = doc.fonts.ready;
    if (doc.fonts.status !== "loading" || ready === this.#fontsAwaited) return;
    this.#fontsAwaited = ready;
    const refit = () => {
      if (this.#fontsAwaited !== ready) return;
      this.#fontsAwaited = undefined;
      if (this.document === doc) this.refreshStyles();
    };
    // A face that failed to load leaves fallback text, which is already laid out.
    void ready.then(refit, refit);
  }
  setImageSize() {
    if (!this.#layout) return;
    const { width, height, margin } = this.#layout;
    const vertical = this.#vertical;
    const doc = this.document;
    const win = doc?.defaultView;
    if (!doc || !win) return;
    // Read every image's constraints, then write them: a write between two
    // reads would have the styles recomputed for each image.
    const spacing: BlockSpacing = new Map();
    const sizes: [HTMLElement | SVGElement, Record<string, string>][] = [];
    for (const el of doc.body.querySelectorAll<HTMLElement | SVGElement>("img, svg, video, canvas")) {
      if (el.parentElement?.closest("svg")) continue;
      // preserve max size if they are already set
      const { maxHeight, maxWidth } = win.getComputedStyle(el);
      sizes.push([
        el,
        {
          "max-height": vertical
            ? maxHeight !== "none" && maxHeight !== "0px"
              ? maxHeight
              : "100%"
            : `${Math.max(1, height - (this.#column ? imageBlockSpacing(el, win, spacing) : margin * 2))}px`,
          "max-width": vertical
            ? `${width - margin * 2}px`
            : maxWidth !== "none" && maxWidth !== "0px"
              ? maxWidth
              : "100%",
          "object-fit": "contain",
          "page-break-inside": "avoid",
          "break-inside": "avoid",
          "box-sizing": "border-box",
        },
      ]);
    }
    for (const [el, styles] of sizes) setStylesImportant(el, styles);
  }
  /** The document's styles, fonts or media changed: bound, fit and measure it again. */
  refreshStyles() {
    if (this.#destroyed) return;
    const doc = this.document;
    if (doc && this.#layout) this.#layOut(doc);
  }
  get contentOffset() {
    return this.#contentOffset;
  }
  get fullSize() {
    return this.#fullSize;
  }
  /**
   * Where the selected chapter begins in the source, and the source's whole
   * extent, in the units of `contentOffset` and `contentSize`. While part of
   * the document is deferred they are estimated from the text laid out so
   * far; the laid-out geometry itself is always exact.
   */
  get sourceOffset() {
    const window = this.#window;
    return window?.laidOut
      ? this.#contentOffset + (window.waitingBefore / window.laidOut) * this.#contentSize
      : this.#contentOffset;
  }
  get sourceSize() {
    const window = this.#window;
    return window?.laidOut ? (window.weight / window.laidOut) * this.#contentSize : this.#contentSize;
  }
  /** `sourceSize` with the reader's margins, as `fullSize` has them. */
  get sourceFullSize() {
    return this.sourceSize + this.#fullSize - this.#contentSize;
  }
  get contentSize() {
    return this.#contentSize;
  }
  get chapterIndex() {
    return this.#chapters?.index ?? 0;
  }
  get startsChapter() {
    return this.chapterIndex > 0 || !!this.#chapters?.startsAtBeginning;
  }
  get leadingMargin() {
    return this.#firstPart ? (this.#layout?.margin ?? 0) : 0;
  }
  setChapterEdges(first: boolean, last: boolean) {
    this.#firstPart = first;
    this.#lastPart = last;
    this.#applyChapterWindow();
  }
  hasChapter(dir: -1 | 1) {
    return this.#chapters?.hasAdjacent(dir) ?? false;
  }
  turnChapter(dir: -1 | 1) {
    if (!this.#chapters?.hasAdjacent(dir)) return false;
    this.#chapters.index += dir;
    this.#applyChapterWindow();
    return true;
  }
  clampRange(range: Range) {
    return this.#chapters?.clamp(range) ?? range;
  }
  // Public fractions address the source section, whereas internal scrolling
  // addresses the selected chapter. Element/Range anchors keep their identity.
  selectChapter(anchor: Anchor): Anchor {
    // Root targets mean the source start, not the body's margin/padding.
    if (anchor === this.document?.body || anchor === this.document?.documentElement) anchor = 0;
    // A fraction is resolved against the source's whole extent.
    if (typeof anchor === "number" && anchor > 0 && anchor < 1) this.layOutAll();
    if (!this.#chapters || this.#chapters.starts.length === 1) return anchor;
    const sourceOffset =
      typeof anchor === "number"
        ? this.#column
          ? Math.round(anchor * Math.max(0, this.#contentSize / this.#size - 1)) * this.#size
          : anchor * this.#fullSize
        : 0;
    if (typeof anchor === "number")
      this.#chapters.index =
        anchor >= 1
          ? this.#chapterOffsets.length - 1
          : Math.max(
              0,
              this.#chapterOffsets.findLastIndex((offset) => offset <= sourceOffset),
            );
    else this.#chapters.select(anchor);
    this.#applyChapterWindow();
    if (typeof anchor !== "number") return anchor;
    if (anchor >= 1) return 1;
    const verticalAxis = this.#column ? this.#vertical : !this.#vertical;
    const extent = this.#element.getBoundingClientRect()[verticalAxis ? "height" : "width"];
    const distance = this.#column ? extent - this.#size * 3 : extent;
    return distance > 0 ? Math.max(0, Math.min(1, (sourceOffset - this.#contentOffset) / distance)) : 0;
  }
  #applyChapterWindow() {
    if (!this.#layout) return;
    const vertical = this.#vertical,
      column = this.#column;
    const y = column ? vertical : !vertical;
    const reverse = !y && (column ? this.#rtl : vertical);
    const side = y ? "height" : "width";
    const starts = this.#chapters?.starts ?? [null];
    const pitch = this.#size / Math.max(1, Math.round(this.#size / (this.#layout.columnWidth + this.#layout.gap)));
    this.#chapterOffsets = starts.map((element) => {
      if (!element) return 0;
      // A chapter that starts in content not laid out yet has no place of
      // its own: it begins where the laid-out content ends, or began before it.
      const side = this.#window?.side(element) ?? 0;
      if (side) return side > 0 ? this.#contentSize : 0;
      const rect = element.getClientRects()[0] ?? element.getBoundingClientRect();
      const offset = y ? rect.top : reverse ? this.#contentSize - rect.right : rect.left;
      return Math.max(0, column ? Math.floor((offset + 0.5) / pitch) * pitch : offset);
    });
    const index = this.#chapters?.index ?? 0;
    let start = this.#chapterOffsets[index] ?? 0;
    let end = this.#chapterOffsets[index + 1] ?? this.#contentSize;
    // Internal source edges are not page edges. Clip their body padding
    // without changing the source layout used by CFIs and annotations.
    const doc = this.document;
    if (!column && doc?.defaultView) {
      const style = doc.defaultView.getComputedStyle(doc.body);
      if (!this.#firstPart && index === 0) start += parseFloat(vertical ? style.paddingRight : style.paddingTop) || 0;
      if (!this.#lastPart && index === starts.length - 1)
        end -= parseFloat(vertical ? style.paddingLeft : style.paddingBottom) || 0;
    }
    end = Math.max(start, end);
    this.#contentOffset = start;
    const length = Math.max(1, end - start);
    const size = column ? Math.ceil(length / this.#size) * this.#size : length;
    this.#element.style[side] = `${size + (column ? this.#size * 2 : 0)}px`;
    if (!column) {
      const before = this.leadingMargin,
        after = this.#lastPart ? this.#layout.margin : 0;
      this.#element.style.padding = vertical ? `0 ${before}px 0 ${after}px` : `${before}px 0 ${after}px`;
      if (this.#overlayer) this.#overlayer.element.style.margin = this.#element.style.padding;
    }
    // The iframe retains the complete source layout. Clip its chapter and
    // translate it into a bounded scroll surface; source DOM and CFIs stay intact.
    const shift = (this.#contentSize - size) / 2 - start;
    this.#iframe.style.transform = `translate${y ? "Y" : "X"}(${reverse ? -shift : shift}px)`;
    const trailing = Math.max(0, this.#contentSize - end);
    const clip = y
      ? `inset(${start}px 0 ${trailing}px 0)`
      : reverse
        ? `inset(0 ${start}px 0 ${trailing}px)`
        : `inset(0 ${trailing}px 0 ${start}px)`;
    this.#iframe.style.clipPath = clip;
    if (this.#overlayer) {
      this.#overlayer.element.style.transform = `translate${y ? "Y" : "X"}(${reverse ? size + start - this.#contentSize : -start}px)`;
      this.#overlayer.element.style.clipPath = clip;
    }
  }
  // A target near the end of a source file still needs to reach the top of
  // the viewport. Keep this temporary scroll room outside the iframe and
  // outside viewSize, so it neither changes CFIs nor adds a blank reading
  // step before the next source section.
  setScrollExtent(minimum: number) {
    if (this.#column || this.#destroyed) return;
    const side = this.#vertical ? "width" : "height";
    const extra = Math.max(0, minimum - this.#element.getBoundingClientRect()[side]);
    this.#element.style.marginBottom = this.#vertical ? "0" : `${extra}px`;
    this.#element.style.marginLeft = this.#vertical ? `${extra}px` : "0";
  }
  /** Measure the laid-out document and size the view to it. `unchangedIsSettled`:
   * a measurement equal to the last one changes nothing and is not reported. */
  expand(unchangedIsSettled = false) {
    // READAWARE: see render() — no document, nothing to measure.
    if (this.#destroyed || !this.document || !this.#layout) return;
    const { documentElement } = this.document;
    const measured = this.#contentSize;
    if (this.#column) {
      const side = this.#vertical ? "height" : "width";
      const otherSide = this.#vertical ? "width" : "height";
      const contentRect = this.#contentRange.getBoundingClientRect();
      const rootRect = documentElement.getBoundingClientRect();
      // offset caused by column break at the start of the page
      // which seem to be supported only by WebKit and only for horizontal writing
      const contentStart = this.#vertical
        ? 0
        : this.#rtl
          ? rootRect.right - contentRect.right
          : contentRect.left - rootRect.left;
      const contentSize = contentStart + contentRect[side];
      const pageCount = Math.ceil(contentSize / this.#size);
      const expandedSize = pageCount * this.#size;
      if (unchangedIsSettled && expandedSize === measured) return;
      this.#contentSize = expandedSize;
      this.#fullSize = expandedSize + this.#size * 2;
      this.#element.style.padding = "0";
      this.#iframe.style[side] = `${expandedSize}px`;
      this.#element.style[side] = `${expandedSize + this.#size * 2}px`;
      this.#iframe.style[otherSide] = "100%";
      this.#element.style[otherSide] = "100%";
    } else {
      const side = this.#vertical ? "width" : "height";
      const otherSide = this.#vertical ? "height" : "width";
      const contentSize = documentElement.getBoundingClientRect()[side];
      const expandedSize = contentSize;
      if (unchangedIsSettled && expandedSize === measured) return;
      const { margin } = this.#layout;
      this.#contentSize = expandedSize;
      this.#fullSize = expandedSize + margin * 2;
      const padding = this.#vertical ? `0 ${margin}px` : `${margin}px 0`;
      this.#element.style.padding = padding;
      this.#iframe.style[side] = `${expandedSize}px`;
      this.#element.style[side] = `${expandedSize}px`;
      this.#iframe.style[otherSide] = "100%";
      this.#element.style[otherSide] = "100%";
    }
    this.#placeOverlayer();
    this.#applyChapterWindow();
    this.onExpand();
  }
  /** Lay the annotation layer over the measured document and draw it. */
  #placeOverlayer() {
    const overlayer = this.#overlayer;
    if (!overlayer || !this.#layout) return;
    const { style } = overlayer.element;
    if (this.#column) {
      style.margin = "0";
      style.left = this.#vertical ? "0" : `${this.#size}px`;
      style.top = this.#vertical ? `${this.#size}px` : "0";
      style[this.#vertical ? "height" : "width"] = `${this.#contentSize}px`;
    } else {
      const { margin } = this.#layout;
      style.margin = this.#vertical ? `0 ${margin}px` : `${margin}px 0`;
      style.left = "0";
      style.top = "0";
      style[this.#vertical ? "width" : "height"] = `${this.#contentSize}px`;
    }
    overlayer.redraw();
  }
  set overlayer(overlayer) {
    this.#overlayer = overlayer;
    if (!overlayer) return;
    this.#element.append(overlayer.element);
    // The document is measured by the time its annotation layer is attached.
    this.#placeOverlayer();
    this.#applyChapterWindow();
  }
  get overlayer() {
    return this.#overlayer;
  }
  destroy() {
    this.#destroyed = true;
    this.#cancelLoad?.();
    this.#observer.disconnect();
  }
}
