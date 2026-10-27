import type { Overlayer } from "./overlayer.js";
import { getDirection, getBackground, setStylesImportant } from "./paginator-geometry.js";
import { imageBlockSpacing, isImageOnlyDocument } from "./paginator-media.js";
import type { Anchor, ResolvedNavigation } from "./book.js";
import { ChapterRanges } from "./paginator-chapters.js";
import { fitWideContent, flowBody } from "./paginator-fit.js";

export type Layout = {
  width: number;
  height: number;
  margin: number;
  gap: number;
  columnWidth: number;
  flow?: string | null;
};

export type BeforeRender = { vertical: boolean; rtl: boolean; background?: string };

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

  #observer = new ResizeObserver(() => this.expand());
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
  async load(src: string, afterLoad?: (doc: Document) => void, beforeRender?: (input: BeforeRender) => Layout) {
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
          doc.documentElement.toggleAttribute("data-foliate-image-page", isImageOnlyDocument(doc));
          afterLoad?.(doc);
          this.#chapters = new ChapterRanges(doc, this.chapterStarts);

          // It must be visible for Firefox to compute page styles.
          this.#iframe.style.display = "block";
          const { vertical, rtl } = getDirection(doc);
          const background = getBackground(doc);
          this.#iframe.style.display = "none";
          this.#vertical = vertical;
          this.#rtl = rtl;
          this.#contentRange.selectNodeContents(doc.body);
          const layout = beforeRender?.({ vertical, rtl, background });
          // Reveal only once the fonts the laid-out text uses have arrived.
          // visibility, not display: layout runs and the loads are triggered.
          this.#iframe.style.display = "block";
          this.#iframe.style.visibility = "hidden";
          this.render(layout);
          this.#observer.observe(doc.body);
          // Force layout so the face loads start now, not on first paint.
          void doc.documentElement.getBoundingClientRect();

          // Firefox's iframe resize observer can miss font-driven changes.
          void doc.fonts.ready
            .then(() => this.refreshStyles())
            .catch((error: unknown) => console.warn("Could not refresh styles after fonts loaded", error));

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
    this.setImageSize();
    fitWideContent(doc);
    this.expand();
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
      ...(vertical ? { width: `${width}px` } : { height: `${height}px` }),
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
    this.setImageSize();
    fitWideContent(doc);
    this.expand();
  }
  setImageSize() {
    if (!this.#layout) return;
    const { width, height, margin } = this.#layout;
    const vertical = this.#vertical;
    const doc = this.document;
    if (!doc?.defaultView) return;
    for (const el of doc.body.querySelectorAll<HTMLElement | SVGElement>("img, svg, video, canvas")) {
      if (el.parentElement?.closest("svg")) continue;
      // preserve max size if they are already set
      const { maxHeight, maxWidth } = doc.defaultView.getComputedStyle(el);
      setStylesImportant(el, {
        "max-height": vertical
          ? maxHeight !== "none" && maxHeight !== "0px"
            ? maxHeight
            : "100%"
          : `${Math.max(1, height - (this.#column ? imageBlockSpacing(el, doc.defaultView) : margin * 2))}px`,
        "max-width": vertical
          ? `${width - margin * 2}px`
          : maxWidth !== "none" && maxWidth !== "0px"
            ? maxWidth
            : "100%",
        "object-fit": "contain",
        "page-break-inside": "avoid",
        "break-inside": "avoid",
        "box-sizing": "border-box",
      });
    }
  }
  refreshStyles() {
    if (this.#destroyed) return;
    this.setImageSize();
    const doc = this.document;
    if (doc && this.#layout) fitWideContent(doc);
    this.expand();
  }
  get contentOffset() {
    return this.#contentOffset;
  }
  get fullSize() {
    return this.#fullSize;
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
  expand() {
    // READAWARE: see render() — no document, nothing to measure.
    if (this.#destroyed || !this.document || !this.#layout) return;
    const { documentElement } = this.document;
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
      this.#contentSize = expandedSize;
      this.#fullSize = expandedSize + this.#size * 2;
      this.#element.style.padding = "0";
      this.#iframe.style[side] = `${expandedSize}px`;
      this.#element.style[side] = `${expandedSize + this.#size * 2}px`;
      this.#iframe.style[otherSide] = "100%";
      this.#element.style[otherSide] = "100%";
      documentElement.style[side] = `${this.#size}px`;
      if (this.#overlayer) {
        this.#overlayer.element.style.margin = "0";
        this.#overlayer.element.style.left = this.#vertical ? "0" : `${this.#size}px`;
        this.#overlayer.element.style.top = this.#vertical ? `${this.#size}px` : "0";
        this.#overlayer.element.style[side] = `${expandedSize}px`;
        this.#overlayer.redraw();
      }
    } else {
      const side = this.#vertical ? "width" : "height";
      const otherSide = this.#vertical ? "height" : "width";
      const contentSize = documentElement.getBoundingClientRect()[side];
      const expandedSize = contentSize;
      const { margin } = this.#layout;
      this.#contentSize = expandedSize;
      this.#fullSize = expandedSize + margin * 2;
      const padding = this.#vertical ? `0 ${margin}px` : `${margin}px 0`;
      this.#element.style.padding = padding;
      this.#iframe.style[side] = `${expandedSize}px`;
      this.#element.style[side] = `${expandedSize}px`;
      this.#iframe.style[otherSide] = "100%";
      this.#element.style[otherSide] = "100%";
      if (this.#overlayer) {
        this.#overlayer.element.style.margin = padding;
        this.#overlayer.element.style.left = "0";
        this.#overlayer.element.style.top = "0";
        this.#overlayer.element.style[side] = `${expandedSize}px`;
        this.#overlayer.redraw();
      }
    }
    this.#applyChapterWindow();
    this.onExpand();
  }
  set overlayer(overlayer) {
    this.#overlayer = overlayer;
    if (overlayer) this.#element.append(overlayer.element);
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
