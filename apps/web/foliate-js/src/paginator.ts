import { SectionView, type Layout, type BeforeRender } from "./paginator-view.js";
import {
  uncollapse,
  getVisibleRange,
  selectionIsBackward,
  setSelectionTo,
  getBackground,
  makeMarginals,
  type RectMapper,
} from "./paginator-geometry.js";
import type { Anchor, Book, BookSection, MaybePromise, ResolvedNavigation, ResourceTransformDetail } from "./book.js";

import type { Overlayer } from "./overlayer.js";
import { swipePageStep, type SwipeSample } from "./page-swipe.js";
import { RendererResizeObserver } from "./resize-observer.js";

import type { Content, EdgeDetail, LoadDetail, RelocateDetail, RelocateReason, NativeInputBridge } from "./renderer.js";

type Styles = string | [string, string] | null | undefined;

/** A one-finger page drag: the last finger position, the page it started on,
 * and its travel samples for {@link swipePageStep}. */
type TouchState = { x: number; y: number; page: number; samples: SwipeSample[]; pinched?: boolean };

type SectionEntry = { index: number; view: SectionView; release: () => void };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const debounce = <Args extends unknown[]>(f: (...args: Args) => void, wait: number, immediate = false) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (...args: Args) => {
    const later = () => {
      timeout = null;
      if (!immediate) f(...args);
    };
    const callNow = immediate && !timeout;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) f(...args);
  };
};

const lerp = (min: number, max: number, x: number) => x * (max - min) + min;

const easeOutQuad = (x: number) => 1 - (1 - x) * (1 - x);

const animate = (
  a: number,
  b: number,
  duration: number,
  ease: (fraction: number) => number,
  render: (value: number) => void,
) =>
  new Promise<void>((resolve) => {
    let start: number | undefined;
    const step = (now: number) => {
      if (document.hidden) {
        render(lerp(a, b, 1));
        return resolve();
      }
      start ??= now;
      const fraction = Math.min(1, (now - start) / duration);
      render(lerp(a, b, ease(fraction)));
      if (fraction < 1) requestAnimationFrame(step);
      else resolve();
    };
    if (document.hidden) {
      render(lerp(a, b, 1));
      return resolve();
    }
    requestAnimationFrame(step);
  });

// NOTE: everything here assumes the so-called "negative scroll type" for RTL
export class Paginator extends HTMLElement {
  inputBridge?: NativeInputBridge;
  #inputRevision = 0;
  #focusRequest: object | undefined;
  bookDir: string | null | undefined;
  sections: BookSection[] = [];
  heads: Element[] | null = null;
  feet: Element[] | null = null;

  static observedAttributes = ["flow", "gap", "margin", "max-inline-size", "max-block-size", "max-column-count"];
  #root = this.attachShadow({ mode: "closed" });
  #observer = new RendererResizeObserver(
    () => this.inputBridge,
    () => this.#anchorContext,
    () => this.#navigation,
    (context) => this.render(context),
  );
  #top: HTMLElement;
  #background: HTMLElement;
  #container: HTMLElement;
  #header: HTMLElement;
  #footer: HTMLElement;
  #view: SectionView | null = null;
  #entries: SectionEntry[] = [];
  #building: number | undefined;
  // Continuous scroll keeps a resident window of a TOC chapter's source
  // files around the viewport rather than the whole chapter: files are
  // added as the reader approaches an edge and released once far behind.
  // The token identifies the chapter surface; replacing it (another
  // chapter, close) invalidates in-flight extensions.
  #chapterToken = 0;
  #chapterEdges: { first?: number; last?: number } = {};
  #extending: Partial<Record<-1 | 1, Promise<boolean>>> = {};
  #extensionFailed: Partial<Record<-1 | 1, number>> = {};
  #maintaining: Promise<void> | undefined;
  #maintainFrame: number | undefined;
  #maintainAgain = false;
  #windowing = 0;
  #layingOut = false;
  #deferredLayout = false;
  #pendingRender: Promise<void> = Promise.resolve();
  #anchorIndex = -1;
  #touchDocs = new WeakSet<Document>();
  #selectionDocs = new WeakSet<Document>();
  #scrollSuspensions = 0;
  #chapterStarts: ReadonlyMap<number, readonly ResolvedNavigation[]> = new Map();
  #vertical = false;
  #rtl = false;
  #margin = 0;
  #index = -1;
  #anchor: Anchor = 0; // anchor view to a fraction (0-1), Range, or Element
  // Scroll offset at which #anchor was last valid. A reader who has scrolled
  // since is not sent back there by a late expansion (fonts, images).
  #anchoredScroll = 0;
  #anchorContext: object | undefined;
  #scrollFeedback: { position: number; context: object } | undefined;
  #justAnchored = false;
  #locked = false; // while true, prevent any further navigation
  #styles: Styles;
  #styleRevision = 0;
  #layoutValues = new Map<string, string | null>();
  #styleMap = new WeakMap<Document, [HTMLStyleElement, HTMLStyleElement]>();
  #mediaQuery = matchMedia("(prefers-color-scheme: dark)");
  #mediaQueryListener;
  #scrollBounds: [number, number, number] = [0, 0, 0];
  #touchState: TouchState | null = null;
  #touchScrolled = false;
  #lastVisibleRange: Range | null = null;
  #navigation = 0;
  constructor() {
    super();
    this.#root.innerHTML = `<style>
        :host {
            display: block;
            container-type: size;
        }
        :host, #top {
            box-sizing: border-box;
            position: relative;
            overflow: hidden;
            width: 100%;
            height: 100%;
        }
        #top {
            --_gap: 7%;
            --_margin: 48px;
            --_max-inline-size: 720px;
            --_max-block-size: 1440px;
            --_max-column-count: 2;
            --_max-column-count-portrait: 1;
            --_max-column-count-spread: var(--_max-column-count);
            --_half-gap: calc(var(--_gap) / 2);
            --_max-width: calc(var(--_max-inline-size) * var(--_max-column-count-spread));
            --_max-height: var(--_max-block-size);
            display: grid;
            grid-template-columns:
                minmax(var(--_half-gap), 1fr)
                var(--_half-gap)
                minmax(0, calc(var(--_max-width) - var(--_gap)))
                var(--_half-gap)
                minmax(var(--_half-gap), 1fr);
            grid-template-rows:
                minmax(var(--_margin), 1fr)
                minmax(0, var(--_max-height))
                minmax(var(--_margin), 1fr);
            &.vertical {
                --_max-column-count-spread: var(--_max-column-count-portrait);
                --_max-width: var(--_max-block-size);
                --_max-height: calc(var(--_max-inline-size) * var(--_max-column-count-spread));
            }
            @container (orientation: portrait) {
                & {
                    --_max-column-count-spread: var(--_max-column-count-portrait);
                }
                &.vertical {
                    --_max-column-count-spread: var(--_max-column-count);
                }
            }
        }
        #background {
            grid-column: 1 / -1;
            grid-row: 1 / -1;
        }
        #container {
            grid-column: 2 / 5;
            grid-row: 2;
            overflow: hidden;
        }
        :host([flow="scrolled"]) #container {
            grid-column: 1 / -1;
            grid-row: 1 / -1;
            overflow: auto;
            display: flex;
            flex-direction: column;
        }
        :host([flow="scrolled"]) #top.vertical #container {
            flex-direction: row;
        }
        /* ReadAware patch: the scroll-mode scroller lives in this closed shadow
           root, out of reach of the app's global scrollbar CSS — so mirror that
           hairline scrollbar here (see apps/web/src/index.css). Custom properties
           inherit across the shadow boundary, so the app tokens (and their dark
           theme override) resolve; the fallbacks cover foliate running alone.
           Note: we deliberately do NOT set scrollbar-width — a non-auto value
           disables ::-webkit-scrollbar in WebKit/Chromium and brings the native
           track + hover-thickening back. */
        #container::-webkit-scrollbar {
            width: var(--ra-scrollbar-size, 3px);
            height: var(--ra-scrollbar-size, 3px);
        }
        #container::-webkit-scrollbar-track,
        #container::-webkit-scrollbar-corner {
            background: transparent;
            border: 0;
        }
        #container::-webkit-scrollbar-thumb {
            background-color: var(--ra-scrollbar-color, rgb(28 25 23 / 0.42));
            border: 0;
            border-radius: 9999px;
        }
        #header {
            grid-column: 3 / 4;
            grid-row: 1;
        }
        #footer {
            grid-column: 3 / 4;
            grid-row: 3;
            align-self: end;
        }
        #header, #footer {
            display: grid;
            height: var(--_margin);
        }
        :is(#header, #footer) > * {
            display: flex;
            align-items: center;
            min-width: 0;
        }
        :is(#header, #footer) > * > * {
            width: 100%;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            text-align: center;
            font-size: .75em;
            opacity: .6;
        }
        </style>
        <div id="top">
            <div id="background" part="filter"></div>
            <div id="header"></div>
            <div id="container"></div>
            <div id="footer"></div>
        </div>
        `;

    const templateElement = (id: string): HTMLElement => {
      const element = this.#root.getElementById(id);
      if (!element) throw new Error(`Missing paginator template element: ${id}`);
      return element;
    };
    this.#top = templateElement("top");
    this.#background = templateElement("background");
    this.#container = templateElement("container");
    this.#header = templateElement("header");
    this.#footer = templateElement("footer");

    this.#observer.observe(this.#container);
    this.#container.addEventListener("scroll", () => this.dispatchEvent(new Event("scroll")));
    // Window maintenance follows the raw scroll position, once per frame:
    // the debounced relocation below deliberately skips anchor scrolls.
    this.#container.addEventListener(
      "scroll",
      () => {
        if (!this.scrolled || this.#windowing || this.#maintainFrame !== undefined) return;
        this.#maintainFrame = requestAnimationFrame(() => {
          this.#maintainFrame = undefined;
          if (this.scrolled && !this.#windowing) void this.#maintainWindow(this.#anchorContext ?? {});
        });
      },
      { passive: true },
    );
    this.#container.addEventListener(
      "scroll",
      debounce(() => {
        if (this.scrolled) {
          if (this.#justAnchored) this.#justAnchored = false;
          else {
            const feedback = this.#scrollFeedback;
            this.#afterScroll(
              "scroll",
              feedback?.position === this.#container[this.scrollProp] ? feedback.context : {},
            );
          }
        }
      }, 250),
    );

    const opts = { passive: false };
    const guardScroll = (event: WheelEvent) => {
      if (this.#scrollSuspensions && event.cancelable) event.preventDefault();
    };
    this.addEventListener("wheel", guardScroll, opts);
    const input = () => {
      this.#inputRevision++;
      this.#focusRequest = undefined;
      this.#scrollFeedback = undefined;
      this.#justAnchored = false;
    };
    for (const name of ["pointerdown", "wheel", "touchstart", "keydown"])
      this.addEventListener(name, input, { capture: true, passive: true });
    this.addEventListener("touchstart", this.#onTouchStart.bind(this), opts);
    this.addEventListener("touchmove", this.#onTouchMove.bind(this), opts);
    this.addEventListener("touchend", this.#onTouchEnd.bind(this));
    this.addEventListener("load", (event) => {
      const { doc } = (event as CustomEvent<LoadDetail>).detail;
      if (this.#touchDocs.has(doc)) return;
      this.#touchDocs.add(doc);
      doc.addEventListener("wheel", guardScroll, opts);
      for (const name of ["pointerdown", "wheel", "touchstart", "keydown"])
        doc.addEventListener(name, input, { capture: true, passive: true });
      doc.addEventListener("touchstart", this.#onTouchStart.bind(this), opts);
      doc.addEventListener("touchmove", this.#onTouchMove.bind(this), opts);
      doc.addEventListener("touchend", this.#onTouchEnd.bind(this));
    });

    this.addEventListener("relocate", (event) => {
      const { detail } = event as CustomEvent<RelocateDetail>;
      const select = (anchor: Anchor | null, collapse: -1 | 0 | 1) => {
        setSelectionTo(anchor, collapse);
        const doc =
          anchor && typeof anchor !== "number"
            ? "startContainer" in anchor
              ? anchor.startContainer.ownerDocument
              : anchor.ownerDocument
            : null;
        if (doc) this.inputBridge?.selectionChanged(doc, detail.context ?? {});
      };
      if (detail.reason === "selection") select(this.#anchor, 0);
      else if (detail.reason === "navigation") {
        if (this.#anchor === 1) select(detail.range, 1);
        else if (typeof this.#anchor === "number") select(detail.range, -1);
        else select(this.#anchor, -1);
      }
    });
    const checkPointerSelection = debounce(
      (range: Range, sel: Selection, selected: Range, context: object, revision: number, navigation: number) => {
        if (
          !sel.rangeCount ||
          this.#inputRevision !== revision ||
          this.#navigation !== navigation ||
          this.#view?.document !== selected.startContainer.ownerDocument
        )
          return;
        const selRange = sel.getRangeAt(0);
        if (
          selRange.startContainer !== selected.startContainer ||
          selRange.endContainer !== selected.endContainer ||
          selRange.startOffset !== selected.startOffset ||
          selRange.endOffset !== selected.endOffset
        )
          return;
        const backward = selectionIsBackward(sel);
        if (backward && selRange.compareBoundaryPoints(Range.START_TO_START, range) < 0)
          void this.prev(undefined, context).catch((error: unknown) =>
            console.error("Could not follow the selection backward", error),
          );
        else if (!backward && selRange.compareBoundaryPoints(Range.END_TO_END, range) > 0)
          void this.next(undefined, context).catch((error: unknown) =>
            console.error("Could not follow the selection forward", error),
          );
      },
      700,
    );
    this.addEventListener("load", (event) => {
      const { doc } = (event as CustomEvent<LoadDetail>).detail;
      if (this.#selectionDocs.has(doc)) return;
      this.#selectionDocs.add(doc);
      let isPointerSelecting = false;
      doc.addEventListener("pointerdown", () => (isPointerSelecting = true));
      doc.addEventListener("pointerup", () => (isPointerSelecting = false));
      let isKeyboardSelecting = false;
      doc.addEventListener("keydown", () => (isKeyboardSelecting = true));
      doc.addEventListener("keyup", () => (isKeyboardSelecting = false));
      doc.addEventListener("selectionchange", (event) => {
        if (this.scrolled) return;
        const range = this.#lastVisibleRange;
        if (!range) return;
        const sel = doc.getSelection();
        if (!sel?.rangeCount) return;
        const context = this.inputBridge?.context(event) ?? {};
        if (isPointerSelecting && sel.type === "Range")
          checkPointerSelection(
            range,
            sel,
            sel.getRangeAt(0).cloneRange(),
            context,
            this.#inputRevision,
            this.#navigation,
          );
        else if (isKeyboardSelecting) {
          const selRange = sel.getRangeAt(0).cloneRange();
          const backward = selectionIsBackward(sel);
          if (!backward) selRange.collapse();
          void this.#scrollToAnchor(selRange, "anchor", context).catch((error: unknown) =>
            console.error("Could not follow the keyboard selection", error),
          );
        }
      });
      doc.addEventListener("focusin", (e) => {
        const target = e.target;
        if (this.scrolled || !target || !("nodeType" in target) || target.nodeType !== 1) return;
        // NOTE: `requestAnimationFrame` is needed in WebKit
        const request = {},
          context = this.inputBridge?.context(e) ?? {},
          navigation = this.#navigation;
        this.#focusRequest = request;
        requestAnimationFrame(() => {
          if (
            this.#focusRequest !== request ||
            this.#navigation !== navigation ||
            this.#view?.document !== doc ||
            doc.activeElement !== target
          )
            return;
          this.#focusRequest = undefined;
          void this.#scrollToAnchor(target as Element, "anchor", context);
        });
      });
    });

    this.#mediaQueryListener = () => {
      if (!this.#view?.document) return;
      this.#background.style.background = getBackground(this.#view.document);
    };
    this.#mediaQuery.addEventListener("change", this.#mediaQueryListener);
  }
  attributeChangedCallback(name: string, _: string | null, value: string | null) {
    if (this.#layoutValues.get(name) === value) return;
    this.#layoutValues.set(name, value);
    switch (name) {
      case "flow":
        this.render();
        break;
      case "gap":
      case "margin":
      case "max-block-size":
      case "max-column-count":
        this.#top.style.setProperty("--_" + name, value);
        break;
      case "max-inline-size":
        // needs explicit `render()` as it doesn't necessarily resize
        this.#top.style.setProperty("--_" + name, value);
        this.render();
        break;
    }
  }
  /** Host presentation changes carry one identity through all attributes and
   * their resulting anchor feedback, including deferred CE reactions. */
  setLayoutAttributes(
    values: Partial<
      Record<"flow" | "gap" | "margin" | "max-inline-size" | "max-block-size" | "max-column-count", string>
    >,
    context: object = {},
  ) {
    let changed = false;
    for (const [name, value] of Object.entries(values)) {
      if (this.getAttribute(name) === value && this.#layoutValues.get(name) === value) continue;
      changed = true;
      this.#layoutValues.set(name, value);
      this.setAttribute(name, value);
      if (name !== "flow") this.#top.style.setProperty("--_" + name, value);
    }
    if (changed) this.render(context);
  }
  #transformController: AbortController | undefined;
  /** Configure resolved TOC chapter starts before the first navigation. */
  setChapterStarts(starts: ReadonlyMap<number, readonly ResolvedNavigation[]>) {
    this.#chapterStarts = starts;
  }
  open(book: Book) {
    this.#transformController?.abort();
    this.#transformController = new AbortController();
    this.bookDir = book.dir;
    this.sections = book.sections;
    book.transformTarget?.addEventListener(
      "data",
      (event) => {
        const { detail } = event as CustomEvent<ResourceTransformDetail>;
        if (detail.type !== "text/css") return;
        const w = innerWidth;
        const h = innerHeight;
        detail.data = Promise.resolve(detail.data).then((data) =>
          typeof data !== "string"
            ? data
            : data
                // unprefix as most of the props are (only) supported unprefixed
                .replace(/([{\s;])-epub-/gi, "$1")
                // replace vw and vh as they cause problems with layout
                .replace(/(\d*\.?\d+)vw/gi, (_: string, d: string) => (parseFloat(d) * w) / 100 + "px")
                .replace(/(\d*\.?\d+)vh/gi, (_: string, d: string) => (parseFloat(d) * h) / 100 + "px")
                // `page-break-*` unsupported in columns; replace with `column-break-*`
                .replace(
                  /page-break-(after|before|inside)\s*:/gi,
                  (_: string, x: string) => `-webkit-column-break-${x}:`,
                )
                .replace(
                  /break-(after|before|inside)\s*:\s*(avoid-)?page/gi,
                  (_: string, x: string, y: string | undefined) => `break-${x}: ${y ?? ""}column`,
                ),
        );
      },
      { signal: this.#transformController.signal },
    );
  }
  #dropEntry(entry: SectionEntry) {
    entry.view.destroy();
    entry.view.element.remove();
    entry.release();
    this.#entries = this.#entries.filter((item) => item !== entry);
  }
  #keepEntry(keep?: SectionEntry) {
    for (const entry of this.#entries) if (entry !== keep) this.#dropEntry(entry);
    this.#chapterToken++;
    this.#chapterEdges = {};
    this.#extensionFailed = {};
    this.#view = keep?.view ?? null;
  }
  #activate(entry: SectionEntry, context: object = {}, announce = false) {
    const changed = this.#view !== entry.view;
    this.#view = entry.view;
    this.#index = entry.index;
    if ((changed || announce) && entry.view.ready && entry.view.document)
      this.dispatchEvent(
        new CustomEvent("load", { detail: { doc: entry.view.document, index: entry.index, context } }),
      );
  }
  #createView(index: number, release: () => void): SectionEntry {
    const view = new SectionView({
      container: this,
      chapterStarts: this.#chapterStarts.get(index),
      onExpand: () => {
        // A build lays its own sections out and anchors them itself;
        // only an expansion outside a build needs deferring while the
        // scroll layer is suspended.
        if (this.#building !== undefined || this.#layingOut || !this.#entries.some((entry) => entry.view === view))
          return;
        // A window change measures its own displacement and shifts the
        // scroll position exactly; re-anchoring here would fight it.
        if (this.#windowing) return;
        if (this.#scrollSuspensions) {
          this.#deferredLayout = true;
          return;
        }
        this.#updateChapterEdges();
        // In continuous scroll the anchor lags the reader by the relocate
        // debounce; while they are moving, leave the scroll position alone.
        if (this.scrolled && Math.abs(this.start - this.#anchoredScroll) > 1) return;
        const anchor = this.#entries.find((entry) => entry.index === this.#anchorIndex);
        if (anchor) this.#activate(anchor, this.#anchorContext);
        void this.#scrollToAnchor(this.#anchor, "anchor", this.#anchorContext);
      },
    });
    const entry = { index, view, release };
    const next = this.#entries.find((item) => item.index > index);
    this.#container.insertBefore(view.element, next?.view.element ?? null);
    this.#entries.push(entry);
    this.#entries.sort((a, b) => a.index - b.index);
    return entry;
  }
  // Reader margins belong to the chapter's outer edges only. A resident edge
  // whose neighbour is merely not loaded yet gets no margin: the seam will
  // be filled as the reader approaches it.
  #isChapterStart(entry: SectionEntry) {
    // Without TOC chapter boundaries every source file is its own chapter.
    if (!this.#chapterStarts.size) return true;
    return (
      entry.view.startsChapter ||
      this.#chapterEdges.first === entry.index ||
      this.#adjacentIndex(-1, entry.index) === undefined
    );
  }
  #isChapterEnd(entry: SectionEntry) {
    if (!this.#chapterStarts.size) return true;
    if (entry.view.hasChapter(1) || this.#chapterEdges.last === entry.index) return true;
    const next = this.#adjacentIndex(1, entry.index);
    return next === undefined || this.#startsAtDocumentStart(next);
  }
  // A TOC target at a file's very start (no fragment, or fragment 0) makes
  // that file begin a chapter without loading it. Element anchors need the
  // document; those files are loaded and released if they turn out to start.
  #startsAtDocumentStart(index: number) {
    return (this.#chapterStarts.get(index) ?? []).some((target) => target.anchor == null || target.anchor === 0);
  }
  #updateChapterEdges() {
    for (const [i, entry] of this.#entries.entries()) {
      entry.view.setChapterEdges(
        !this.scrolled || (i === 0 && this.#isChapterStart(entry)),
        !this.scrolled || (i === this.#entries.length - 1 && this.#isChapterEnd(entry)),
      );
      entry.view.setScrollExtent(0);
    }
  }
  /** Whether the current scroll chapter has source content beyond its
   * resident edge in `dir` that is not loaded yet. */
  hasPendingContent(dir: -1 | 1): boolean {
    if (!this.scrolled || !this.#chapterStarts.size) return false;
    const edge = dir < 0 ? this.#entries[0] : this.#entries.at(-1);
    // An edge still loading has no chapter knowledge yet; it is not pending.
    return !!edge && edge.view.ready && !(dir < 0 ? this.#isChapterStart(edge) : this.#isChapterEnd(edge));
  }
  /** Make the part under the viewport start the active document. */
  #activateVisible(context: object = {}) {
    if (!this.scrolled) return;
    const position = this.start + this.#margin;
    const entry =
      this.#entries.find(
        ({ view }) =>
          view.ready && this.#viewOffset(view) + view.element.getBoundingClientRect()[this.sideProp] > position,
      ) ?? this.#entries.findLast(({ view }) => view.ready);
    if (entry) this.#activate(entry, context);
  }
  /** Begin a change to the resident window. Returns the function that ends
   * it: it moves the scroller so the document the reader is looking at
   * stays exactly where it was, keeps the surface long enough to hold that
   * position, and refreshes the reading anchor. Call it before any DOM
   * change, including a continuation's load: a part inserted before the
   * reader pushes their text down as soon as it is laid out. */
  #stableViewport(): () => void {
    // Measure the part the reader is looking at: relocation is debounced,
    // so the active document may lag a fast scroll.
    this.#activateVisible(this.#anchorContext ?? {});
    // The iframe, not the part element: a part losing its leading chapter
    // margin moves its text without moving its box. Positions are taken in
    // scroll-surface coordinates, so a browser clamp of the scroll offset
    // during the change (a surface that briefly shrinks) cannot mislead.
    const frame = this.#view?.document?.defaultView?.frameElement;
    const axis = this.#vertical ? "left" : "top";
    const sign = this.#vertical ? -1 : 1;
    const surfaceOffset = () => (frame ? frame.getBoundingClientRect()[axis] + sign * this.start : 0);
    const startBefore = this.start,
      offsetBefore = surfaceOffset();
    this.#windowing++;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.#windowing--;
      if (!frame || !frame.isConnected) return;
      const start = Math.max(0, startBefore + sign * (surfaceOffset() - offsetBefore));
      const last = this.#entries.at(-1);
      // Keep the surface long enough to hold the position (see setScrollExtent).
      if (last) last.view.setScrollExtent(start + this.size - this.#viewOffset(last.view));
      if (Math.abs(start - this.start) > 0.5) {
        this.#container[this.scrollProp] = this.#vertical ? -start : start;
        this.#scrollFeedback = { position: this.#container[this.scrollProp], context: this.#anchorContext ?? {} };
      }
      // What is on screen now is the reading position. Later expansions
      // (fonts settling in a joined part) re-anchor to this, not to a
      // range recorded before the reader last scrolled.
      const range = this.#getVisibleRange();
      if (range) {
        this.#lastVisibleRange = range;
        this.#anchor = range;
        this.#anchorIndex = this.#index;
        this.#anchoredScroll = this.start;
      }
    };
  }
  #withStableViewport<T>(mutate: () => T): T {
    const end = this.#stableViewport();
    try {
      return mutate();
    } finally {
      end();
    }
  }
  #viewOffset(view = this.#view) {
    if (!this.scrolled) return 0;
    let offset = 0;
    for (const entry of this.#entries) {
      if (entry.view === view) break;
      offset += entry.view.element.getBoundingClientRect()[this.sideProp];
    }
    return offset;
  }
  #beforeRender({ vertical, rtl, background }: BeforeRender): Layout {
    this.#vertical = vertical;
    this.#rtl = rtl;
    this.#top.classList.toggle("vertical", vertical);

    // set background to `doc` background
    // this is needed because the iframe does not fill the whole element
    if (background !== undefined) this.#background.style.background = background;

    const { width, height } = this.#container.getBoundingClientRect();
    const size = vertical ? height : width;

    const style = getComputedStyle(this.#top);
    const maxInlineSize = parseFloat(style.getPropertyValue("--_max-inline-size"));
    const maxColumnCount = parseInt(style.getPropertyValue("--_max-column-count-spread"));
    const margin = parseFloat(style.getPropertyValue("--_margin"));
    this.#margin = margin;

    const g = parseFloat(style.getPropertyValue("--_gap")) / 100;
    // The gap will be a percentage of the #container, not the whole view.
    // This means the outer padding will be bigger than the column gap. Let
    // `a` be the gap percentage. The actual percentage for the column gap
    // will be (1 - a) * a. Let us call this `b`.
    //
    // To make them the same, we start by shrinking the outer padding
    // setting to `b`, but keep the column gap setting the same at `a`. Then
    // the actual size for the column gap will be (1 - b) * a. Repeating the
    // process again and again, we get the sequence
    //     x₁ = (1 - b) * a
    //     x₂ = (1 - x₁) * a
    //     ...
    // which converges to x = (1 - x) * a. Solving for x, x = a / (1 + a).
    // So to make the spacing even, we must shrink the outer padding with
    //     f(x) = x / (1 + x).
    // But we want to keep the outer padding, and make the inner gap bigger.
    // So we apply the inverse, f⁻¹ = -x / (x - 1) to the column gap.
    const gap = (-g / (g - 1)) * size;

    const flow = this.getAttribute("flow");
    if (flow === "scrolled") {
      // FIXME: vertical-rl only, not -lr
      this.setAttribute("dir", vertical ? "rtl" : "ltr");
      this.#top.style.padding = "0";
      const columnWidth = maxInlineSize;

      this.heads = null;
      this.feet = null;
      this.#header.replaceChildren();
      this.#footer.replaceChildren();

      return { flow, height, width, margin, gap, columnWidth };
    }

    const divisor = Math.min(maxColumnCount, Math.ceil(size / maxInlineSize));
    const columnWidth = size / divisor - gap;
    this.setAttribute("dir", rtl ? "rtl" : "ltr");

    const marginalDivisor = vertical ? Math.min(2, Math.ceil(width / maxInlineSize)) : divisor;
    const marginalStyle = {
      gridTemplateColumns: `repeat(${marginalDivisor}, 1fr)`,
      gap: `${gap}px`,
      direction: this.bookDir === "rtl" ? "rtl" : "ltr",
    };
    Object.assign(this.#header.style, marginalStyle);
    Object.assign(this.#footer.style, marginalStyle);
    const heads = makeMarginals(marginalDivisor, "head");
    const feet = makeMarginals(marginalDivisor, "foot");
    this.heads = heads.map((el) => el.children[0]);
    this.feet = feet.map((el) => el.children[0]);
    this.#header.replaceChildren(...heads);
    this.#footer.replaceChildren(...feet);

    return { height, width, margin, gap, columnWidth };
  }
  render(context = this.#anchorContext) {
    if (!this.#view) return;
    if (this.#building !== undefined || this.#scrollSuspensions) {
      this.#deferredLayout = true;
      this.#anchorContext = context;
      return;
    }
    const changeFlow = this.#view.isScrolled !== this.scrolled;
    const anchor = this.#lastVisibleRange?.cloneRange() ?? this.#anchor;
    const active = this.#entries.find((entry) => entry.view === this.#view);
    if (!this.scrolled && active) this.#keepEntry(active);
    this.#anchorContext = context;
    this.#layingOut = true;
    try {
      const layout = this.#beforeRender({ vertical: this.#vertical, rtl: this.#rtl });
      for (const { view } of this.#entries) view.render(layout);
      this.#updateChapterEdges();
    } finally {
      this.#layingOut = false;
    }
    if (changeFlow && this.scrolled && this.#chapterStarts.size) {
      this.#pendingRender = this.#goTo({ index: this.#index, anchor, context });
      void this.#pendingRender.catch((error: unknown) => console.error("Could not render continuous chapter", error));
    } else void this.#scrollToAnchor(this.#anchor, "anchor", this.#anchorContext);
  }
  waitForCurrentRender() {
    return this.#pendingRender;
  }
  /** Resolves once the resident window around the viewport is satisfied:
   * nearby chapter sources loaded, distant ones released. Navigation itself
   * resolves as soon as the target source is shown. */
  async whenChapterSettled(): Promise<void> {
    for (;;) {
      // A scroll has scheduled a pass for the next frame; let it start.
      if (this.#maintainFrame !== undefined) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        continue;
      }
      const current = this.#maintaining;
      if (!current) return;
      await current;
      // Only a maintenance pass started after this one keeps us waiting.
      if (this.#maintaining === current) return;
    }
  }
  /** Pause native momentum before replacing a scroll chapter's bounds.
   * WebKit can otherwise keep displaying the old scrolling layer even though
   * DOM positions and snapshots already describe the new chapter. The host
   * holds this through its cross-fade, so the layer is retired before layout.
   */
  suspendScroll(): () => void {
    if (!this.scrolled) return () => {};
    this.#scrollSuspensions++;
    this.#container.style.overflow = "hidden";
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.#scrollSuspensions === 0) {
        this.#container.style.removeProperty("overflow");
        if (this.#deferredLayout) {
          this.#deferredLayout = false;
          this.render(this.#anchorContext);
        }
      }
    };
  }
  #finishBuild(navigation: number) {
    if (this.#building !== navigation) return;
    this.#building = undefined;
    if (this.#deferredLayout) {
      this.#deferredLayout = false;
      this.render(this.#anchorContext);
    }
  }
  get scrolled() {
    return this.getAttribute("flow") === "scrolled";
  }
  get scrollProp() {
    const { scrolled } = this;
    return this.#vertical ? (scrolled ? "scrollLeft" : "scrollTop") : scrolled ? "scrollTop" : "scrollLeft";
  }
  get sideProp() {
    const { scrolled } = this;
    return this.#vertical ? (scrolled ? "width" : "height") : scrolled ? "height" : "width";
  }
  get size() {
    return this.#container.getBoundingClientRect()[this.sideProp];
  }
  get viewSize() {
    if (this.scrolled)
      return this.#entries.reduce((size, { view }) => size + view.element.getBoundingClientRect()[this.sideProp], 0);
    return this.#view?.element.getBoundingClientRect()[this.sideProp] ?? 0;
  }
  get start() {
    return Math.abs(this.#container[this.scrollProp]);
  }
  get end() {
    return this.start + this.size;
  }
  get page() {
    return Math.floor((this.start + this.end) / 2 / this.size);
  }
  get pages() {
    return Math.round(this.viewSize / this.size);
  }
  scrollBy(options?: ScrollToOptions): void;
  scrollBy(x: number, y: number): void;
  scrollBy(dxOrOptions: number | ScrollToOptions = 0, dy = 0) {
    const dx = typeof dxOrOptions === "number" ? dxOrOptions : (dxOrOptions.left ?? 0);
    if (typeof dxOrOptions !== "number") dy = dxOrOptions.top ?? 0;
    const delta = this.#vertical ? dy : dx;
    const element = this.#container;
    const { scrollProp } = this;
    const [offset, a, b] = this.#scrollBounds;
    const rtl = this.#rtl;
    const min = rtl ? offset - b : offset - a;
    const max = rtl ? offset + a : offset + b;
    element[scrollProp] = Math.max(min, Math.min(max, element[scrollProp] + delta));
  }
  /** Settle a released page drag on the page {@link swipePageStep} chooses. */
  #settleSwipe(state: TouchState) {
    const step = swipePageStep(state.samples, this.size);
    const [offset, a, b] = this.#scrollBounds;
    const { pages, size } = this;
    const min = Math.abs(offset) - a;
    const max = Math.abs(offset) + b;
    const wanted = state.page + step;
    const page = Math.floor(Math.max(min, Math.min(max, (wanted + 0.5) * size)) / size);
    // READAWARE: at the book's first or last page the drag is held in
    // place (the bound is closed), so the snap can never reach the spacer
    // page. A swipe that would have turned a page anywhere else is the
    // reader pushing past the book's edge; tell the host. The edge must
    // already be the resting page: a swipe that merely arrives there is
    // not a push past it.
    const pushed =
      step > 0 && wanted >= pages - 1 && this.atEnd ? 1 : step < 0 && wanted <= 0 && this.atStart ? -1 : null;

    void this.#scrollToPage(page, "snap")
      .then(() => {
        const dir = page <= 0 ? -1 : page >= pages - 1 ? 1 : null;
        if (dir) return this.#goToAdjacent(dir);
        if (pushed) this.dispatchEvent(new CustomEvent<EdgeDetail>("edge", { detail: { dir: pushed } }));
      })
      .catch((error: unknown) => console.error("Could not settle the swipe", error));
  }
  /** The finger's travel since `state`'s last point, in reading order. */
  #swipeTravel(state: TouchState, touch: Touch) {
    const delta = this.#vertical ? state.y - touch.screenY : state.x - touch.screenX;
    return this.#rtl ? -delta : delta;
  }
  #onTouchStart(e: TouchEvent) {
    const touch = e.changedTouches[0];
    if (!touch) return;
    this.#touchState = {
      x: touch.screenX,
      y: touch.screenY,
      page: this.page,
      samples: [{ t: e.timeStamp, travel: 0 }],
    };
  }
  #onTouchMove(e: TouchEvent) {
    const state = this.#touchState;
    if (!state || state.pinched) return;
    state.pinched = (globalThis.visualViewport?.scale ?? 1) > 1;
    if (this.scrolled || state.pinched) return;
    if (e.touches.length > 1) {
      if (this.#touchScrolled) e.preventDefault();
      return;
    }
    e.preventDefault();
    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = state.x - touch.screenX,
      dy = state.y - touch.screenY;
    const travel = (state.samples.at(-1)?.travel ?? 0) + this.#swipeTravel(state, touch);
    state.samples.push({ t: e.timeStamp, travel });
    state.x = touch.screenX;
    state.y = touch.screenY;
    this.#touchScrolled = true;
    this.scrollBy(dx, dy);
  }
  #onTouchEnd(e: TouchEvent) {
    // READAWARE: only a drag moved the page, so only a drag has a position to
    // settle. A tap left it where it was, and snapping back to the touch's
    // starting page would undo whatever the tap itself turned to (tap zones,
    // a text-unit step onto the next page) a frame later.
    const dragged = this.#touchScrolled;
    this.#touchScrolled = false;
    if (this.scrolled || !dragged) return;
    const state = this.#touchState;
    // READAWARE: the lift is the drag's last point; without it a flick's
    // final stretch is missing from the release velocity.
    const touch = e.changedTouches[0];
    if (state && !state.pinched && touch)
      state.samples.push({
        t: e.timeStamp,
        travel: (state.samples.at(-1)?.travel ?? 0) + this.#swipeTravel(state, touch),
      });

    // XXX: Firefox seems to report scale as 1... sometimes...?
    // at this point I'm basically throwing `requestAnimationFrame` at
    // anything that doesn't work
    requestAnimationFrame(() => {
      if ((globalThis.visualViewport?.scale ?? 1) === 1 && this.#touchState) this.#settleSwipe(this.#touchState);
    });
  }
  // allows one to process rects as if they were LTR and horizontal
  #getRectMapper(view = this.#view): RectMapper {
    const offset = view?.contentOffset ?? 0;
    if (this.scrolled) {
      const size = view?.contentSize ?? this.viewSize;
      const margin = (view?.leadingMargin ?? this.#margin) + this.#viewOffset(view);
      return this.#vertical
        ? ({ left, right }) => ({ left: size - right + margin - offset, right: size - left + margin - offset })
        : ({ top, bottom }) => ({ left: top + margin - offset, right: bottom + margin - offset });
    }
    const pxSize = this.#view?.fullSize ?? this.pages * this.size;
    return this.#rtl
      ? ({ left, right }) => ({ left: pxSize - right - offset, right: pxSize - left - offset })
      : this.#vertical
        ? ({ top, bottom }) => ({ left: top - offset, right: bottom - offset })
        : ({ left, right }) => ({ left: left - offset, right: right - offset });
  }
  async #scrollToRect(rect: DOMRect, reason: RelocateReason | null, context: object, view = this.#view) {
    if (this.scrolled) {
      const offset = this.#getRectMapper(view)(rect).left - this.#margin;
      const last = this.#entries.at(-1)?.view;
      last?.setScrollExtent(offset + this.size - this.#viewOffset(last));
      return this.#scrollTo(offset, reason, false, context);
    }
    const offset = this.#getRectMapper(view)(rect).left;
    return this.#scrollToPage(Math.floor(offset / this.size) + (this.#rtl ? -1 : 1), reason, false, context);
  }
  async #scrollTo(offset: number, reason: RelocateReason | null, smooth = false, context: object = {}) {
    const element = this.#container;
    const { scrollProp, size } = this;
    if (element[scrollProp] === offset) {
      this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size];
      this.#scrollFeedback = { position: element[scrollProp], context };
      this.#afterScroll(reason, context);
      return;
    }
    // FIXME: vertical-rl only, not -lr
    if (this.scrolled && this.#vertical) offset = -offset;
    if ((reason === "snap" || smooth) && this.hasAttribute("animated"))
      return animate(element[scrollProp], offset, 300, easeOutQuad, (x) => {
        element[scrollProp] = x;
        this.#scrollFeedback = { position: element[scrollProp], context };
      }).then(() => {
        this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size];
        this.#afterScroll(reason, context);
      });
    else {
      element[scrollProp] = offset;
      this.#scrollFeedback = { position: element[scrollProp], context };
      this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size];
      this.#afterScroll(reason, context);
    }
  }
  async #scrollToPage(page: number, reason: RelocateReason | null, smooth = false, context?: object) {
    const offset = this.size * (this.#rtl ? -page : page);
    return this.#scrollTo(offset, reason, smooth, context);
  }
  async scrollToAnchor(anchor: Anchor, select?: boolean, context?: object) {
    const doc =
      typeof anchor === "number"
        ? this.#view?.document
        : "startContainer" in anchor
          ? anchor.startContainer.ownerDocument
          : anchor.ownerDocument;
    const entry = this.#entries.find((entry) => entry.view.document === doc);
    if (entry) return this.#goTo({ index: entry.index, anchor, select, context });
  }
  async #scrollToAnchor(anchor: Anchor, reason: RelocateReason = "anchor", context: object = {}): Promise<void> {
    this.#anchor = anchor;
    this.#anchorIndex = this.#index;
    this.#anchorContext = context;
    const rects = typeof anchor !== "number" ? uncollapse(anchor)?.getClientRects() : undefined;
    // if anchor is an element or a range
    if (rects) {
      // when the start of the range is immediately after a hyphen in the
      // previous column, there is an extra zero width rect in that column
      const rect = Array.from(rects).find((r) => r.width > 0 && r.height > 0) || rects[0];
      // A stored CFI can resolve to collapsed whitespace or a hidden
      // publisher anchor (common on covers). It has no layout rect;
      // still position the selected chapter and publish its relocation.
      // Otherwise open finishes with no location and an empty reader.
      // A re-anchor after layout has no such duty: an anchor that lost
      // its geometry must not fling the reader to the top.
      if (!rect) return reason === "anchor" ? undefined : this.#scrollToAnchor(0, reason, context);
      // A scroll chapter holds several documents; map the anchor with
      // the part that owns it, not with whichever part is active.
      const doc =
        typeof anchor === "number"
          ? null
          : "startContainer" in anchor
            ? anchor.startContainer.ownerDocument
            : anchor.ownerDocument;
      const owner = this.#entries.find((entry) => entry.view.document === doc)?.view ?? this.#view;
      await this.#scrollToRect(rect, reason, context, owner);
      return;
    }
    // if anchor is a fraction
    if (typeof anchor !== "number") return;
    if (this.scrolled) {
      this.#entries.at(-1)?.view.setScrollExtent(0);
      const size = this.#view?.element.getBoundingClientRect()[this.sideProp] ?? 0;
      const offset = this.#viewOffset() + anchor * size;
      await this.#scrollTo(offset, reason, false, context);
      return;
    }
    const { pages } = this;
    if (!pages) return;
    const textPages = pages - 2;
    const newPage = Math.round(anchor * (textPages - 1));
    await this.#scrollToPage(newPage + 1, reason, false, context);
  }
  #getVisibleRange() {
    const doc = this.#view?.document;
    if (!doc) return null;
    const size = this.#rtl ? -this.size : this.size;
    const range = this.scrolled
      ? getVisibleRange(doc, this.start + this.#margin, this.end - this.#margin, this.#getRectMapper())
      : getVisibleRange(doc, this.start - size, this.end - size, this.#getRectMapper());
    return this.#view?.clampRange(range) ?? range;
  }
  getVisibleRanges(): { index: number; range: Range }[] {
    if (!this.scrolled) {
      const range = this.#getVisibleRange();
      return range ? [{ index: this.#index, range }] : [];
    }
    const start = this.start + this.#margin,
      end = this.end - this.#margin;
    return this.#entries.flatMap(({ view, index }) => {
      const doc = view.document,
        offset = this.#viewOffset(view);
      if (!doc || offset >= end || offset + view.element.getBoundingClientRect()[this.sideProp] <= start) return [];
      return [{ index, range: view.clampRange(getVisibleRange(doc, start, end, this.#getRectMapper(view))) }];
    });
  }
  #afterScroll(reason: RelocateReason | null, context: object = {}) {
    this.#activateVisible(context);
    const range = this.#getVisibleRange();
    if (!range) return;
    this.#lastVisibleRange = range;
    if (this.scrolled && !this.#windowing) void this.#maintainWindow(context);
    // don't set new anchor if relocation was to scroll to anchor
    if (reason !== "selection" && reason !== "navigation" && reason !== "anchor") {
      this.#anchor = range;
      this.#anchorIndex = this.#index;
      this.#anchorContext = context;
    } else this.#justAnchored = true;
    this.#anchoredScroll = this.start;

    const index = this.#index;
    const detail: RelocateDetail = { reason, range, index, context };
    const offset = this.#view?.contentOffset ?? 0;
    if (this.scrolled)
      detail.fraction = Math.max(0, offset + this.start - this.#viewOffset()) / (this.#view?.fullSize || this.viewSize);
    else if (this.pages > 0) {
      const { page, pages } = this;
      this.#header.style.visibility = page > 1 ? "visible" : "hidden";
      const fullContentSize = this.#view?.contentSize || (pages - 2) * this.size;
      detail.fraction = (offset + (page - 1) * this.size) / fullContentSize;
      detail.size = this.size / fullContentSize;
    }
    this.dispatchEvent(new CustomEvent("relocate", { detail }));
  }
  async #loadSection(
    index: number,
    live: () => boolean,
    context: object,
    replace = false,
  ): Promise<SectionEntry | undefined> {
    const section = this.sections[index];
    const src = await section.load();
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        section.unload?.();
      }
    };
    if (!live()) {
      release();
      return;
    }
    if (typeof src !== "string") {
      release();
      throw new Error("Reflowable section must load a document URL");
    }
    if (replace) this.#keepEntry();
    const entry = this.#createView(index, release);
    const { view } = entry;
    if (!this.#view) this.#activate(entry);
    try {
      await view.load(
        src,
        (doc) => {
          if (!live()) return;
          if (doc.head) {
            const before = doc.createElement("style"),
              after = doc.createElement("style");
            doc.head.prepend(before);
            doc.head.append(after);
            this.#styleMap.set(doc, [before, after]);
          }
          this.#applyStyles(view);
          this.dispatchEvent(new CustomEvent("load", { detail: { doc, index, context } }));
        },
        (direction) =>
          this.#beforeRender(this.#view === view ? direction : { vertical: this.#vertical, rtl: this.#rtl }),
      );
      if (!live()) {
        this.#dropEntry(entry);
        return;
      }
      this.dispatchEvent(
        new CustomEvent("create-overlayer", {
          detail: {
            doc: view.document,
            index,
            context,
            attach: (overlayer: Overlayer) => (view.overlayer = overlayer),
          },
        }),
      );
      view.refreshStyles();
      return entry;
    } catch (error) {
      this.#dropEntry(entry);
      if (this.#view === view) this.#view = null;
      if (live()) throw error;
    }
  }
  // Resident window policy, in viewports: load the next source once the
  // reader is within PREFETCH of a resident edge; release sources more than
  // RETAIN beyond the viewport. Bounded work and memory for any chapter size.
  static readonly #PREFETCH = 2;
  static readonly #RETAIN = 3;
  #maintainWindow(context: object = {}): Promise<void> {
    if (this.#maintaining) {
      this.#maintainAgain = true;
      return this.#maintaining;
    }
    const run = (async () => {
      do {
        this.#maintainAgain = false;
        // A navigation in progress schedules its own maintenance once
        // the target is shown; a debounced scroll must not act on a
        // half-built surface.
        if (!this.scrolled || !this.#chapterStarts.size || !this.#view?.ready || this.#building !== undefined) return;
        const size = this.size;
        if (!size) return;
        this.#activateVisible(context);
        if (this.viewSize - this.end < size * Paginator.#PREFETCH && this.#extensionFailed[1] === undefined)
          await this.#extend(1, context);
        if (this.start < size * Paginator.#PREFETCH && this.#extensionFailed[-1] === undefined)
          await this.#extend(-1, context);
        this.#releaseDistant();
      } while (this.#maintainAgain);
    })();
    // Clear only after the promise settles, so a pass that returns
    // synchronously cannot leave a resolved promise registered forever.
    this.#maintaining = run;
    void run
      .finally(() => {
        if (this.#maintaining === run) this.#maintaining = undefined;
      })
      .catch((error: unknown) => console.warn("Chapter window maintenance failed", error));
    return run;
  }
  /** Load the chapter's next source in `dir` onto the resident edge.
   * Resolves true when a source was added. */
  #extend(dir: -1 | 1, context: object = {}): Promise<boolean> {
    const pending = this.#extending[dir];
    if (pending) return pending;
    const run = (async () => {
      const token = this.#chapterToken;
      const live = () => token === this.#chapterToken && this.scrolled;
      const edge = dir < 0 ? this.#entries[0] : this.#entries.at(-1);
      if (!edge || !this.hasPendingContent(dir)) return false;
      const index = this.#adjacentIndex(dir, edge.index);
      if (index === undefined) return false;
      // The joining part enters the surface (and lays out) while it loads,
      // so the reader's position is captured before the load and restored
      // once the part is placed; expansions in between must not re-anchor.
      const settle = this.#stableViewport();
      try {
        let next: SectionEntry | undefined;
        try {
          next = await this.#loadSection(index, live, context);
        } catch (error) {
          // Leave the edge open for an explicit retry (next navigation
          // or page turn) instead of hammering a failing source on scroll.
          this.#extensionFailed[dir] = index;
          console.warn("Could not load chapter continuation", index, error);
          return false;
        }
        if (!next || !live()) return false;
        next.view.selectChapter(dir < 0 ? 1 : 0);
        if (dir > 0 && next.view.startsChapter) {
          this.#dropEntry(next);
          this.#chapterEdges.last = edge.index;
          this.#updateChapterEdges();
          return false;
        }
        if (dir < 0 && next.view.startsChapter) this.#chapterEdges.first = next.index;
        this.#updateChapterEdges();
        return true;
      } finally {
        settle();
      }
    })().finally(() => {
      delete this.#extending[dir];
    });
    this.#extending[dir] = run;
    return run;
  }
  /** Release resident sources far outside the viewport, keeping the reading
   * position, the active document and any document holding a selection. */
  #releaseDistant() {
    if (!this.scrolled || this.#entries.length < 2) return;
    const size = this.size;
    const keepFrom = this.start - size * Paginator.#RETAIN,
      keepTo = this.end + size * Paginator.#RETAIN;
    const anchorDoc =
      typeof this.#anchor === "number"
        ? null
        : "startContainer" in this.#anchor
          ? this.#anchor.startContainer.ownerDocument
          : this.#anchor.ownerDocument;
    const distant: SectionEntry[] = [];
    let offset = 0;
    for (const entry of this.#entries) {
      const extent = entry.view.element.getBoundingClientRect()[this.sideProp];
      const doc = entry.view.document;
      const selected = doc?.getSelection()?.isCollapsed === false;
      if (
        (offset + extent < keepFrom || offset > keepTo) &&
        entry.view !== this.#view &&
        doc !== anchorDoc &&
        !selected
      )
        distant.push(entry);
      offset += extent;
    }
    if (!distant.length) return;
    this.#withStableViewport(() => {
      for (const entry of distant) this.#dropEntry(entry);
      this.#updateChapterEdges();
    });
  }
  #canGoToIndex(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index <= this.sections.length - 1;
  }
  async #goTo({ index, anchor, select, context = {} }: ResolvedNavigation, navigation = ++this.#navigation) {
    if (!this.#canGoToIndex(index)) return;
    const hasFocus = this.#view?.document?.hasFocus();
    this.#building = navigation;
    // Any navigation that replaces the scroll chapter's surface must first
    // retire the old native scrolling layer (see suspendScroll). TOC jumps,
    // bookmarks and chapter shortcuts arrive here without the host's
    // cross-fade, so the engine holds the suspension itself.
    let resumeScroll: (() => void) | undefined;
    const retireScrollLayer = () => {
      resumeScroll ??= this.suspendScroll();
    };
    try {
      let entry = this.#entries.find((entry) => entry.index === index && entry.view.ready);
      if (!entry) {
        retireScrollLayer();
        entry = await this.#loadSection(index, () => navigation === this.#navigation, context, true);
      }
      if (!entry || navigation !== this.#navigation) return;
      this.#activate(entry, context);
      const doc = entry.view.document;
      if (!doc) return;
      const chapter = entry.view.chapterIndex;
      const localAnchor = entry.view.selectChapter((typeof anchor === "function" ? anchor(doc) : anchor) ?? 0);
      if (!this.scrolled || chapter !== entry.view.chapterIndex) {
        retireScrollLayer();
        this.#keepEntry(entry);
      }
      this.#extensionFailed = {};
      this.#updateChapterEdges();
      this.#activate(entry, context, true);
      await this.#scrollToAnchor(localAnchor, select ? "selection" : "navigation", context);
      if (hasFocus) this.focusView(context);
    } finally {
      resumeScroll?.();
      this.#finishBuild(navigation);
      // The target source is on screen; its chapter neighbours follow
      // on demand, without holding the navigation open.
      if (navigation === this.#navigation) void this.#maintainWindow(context);
    }
  }
  async goTo(target: MaybePromise<ResolvedNavigation | null | undefined>) {
    if (this.#locked) return;
    this.#pendingRender = Promise.resolve();
    const navigation = ++this.#navigation;
    const resolved = await target;
    if (navigation === this.#navigation && resolved && this.#canGoToIndex(resolved.index))
      return this.#goTo(resolved, navigation);
  }
  async #scrollPrev(distance: number | undefined, context: object): Promise<boolean | undefined> {
    if (!this.#view) return true;
    if (this.scrolled) {
      if (this.start > 0)
        return this.#scrollTo(Math.max(0, this.start - (distance ?? this.size)), null, true, context).then(() => false);
      // The chapter continues above but is not resident yet: bring it
      // in and keep scrolling instead of leaving the chapter.
      if (this.hasPendingContent(-1)) {
        delete this.#extensionFailed[-1];
        if (await this.#extend(-1, context)) return this.#scrollPrev(distance, context);
      }
      return true;
    }
    if (this.atStart) return;
    const page = this.page - 1;
    return this.#scrollToPage(page, "page", true, context).then(() => page <= 0);
  }
  async #scrollNext(distance: number | undefined, context: object): Promise<boolean | undefined> {
    if (!this.#view) return true;
    if (this.scrolled) {
      if (this.viewSize - this.end > 2)
        return this.#scrollTo(
          Math.min(this.viewSize, distance ? this.start + distance : this.end),
          null,
          true,
          context,
        ).then(() => false);
      if (this.hasPendingContent(1)) {
        delete this.#extensionFailed[1];
        if (await this.#extend(1, context)) return this.#scrollNext(distance, context);
      }
      return true;
    }
    if (this.atEnd) return;
    const page = this.page + 1;
    const pages = this.pages;
    return this.#scrollToPage(page, "page", true, context).then(() => page >= pages - 1);
  }
  get atStart() {
    if (this.scrolled) {
      const first = this.#entries[0];
      return !!first && !first.view.hasChapter(-1) && this.#adjacentIndex(-1, first.index) == null && this.start <= 1;
    }
    return !this.#view?.hasChapter(-1) && this.#adjacentIndex(-1) == null && this.page <= 1;
  }
  get atEnd() {
    if (this.scrolled) {
      const last = this.#entries.at(-1);
      return (
        !!last &&
        !last.view.hasChapter(1) &&
        this.#adjacentIndex(1, last.index) == null &&
        this.end >= this.viewSize - 2
      );
    }
    return !this.#view?.hasChapter(1) && this.#adjacentIndex(1) == null && this.page >= this.pages - 2;
  }
  #adjacentIndex(dir: -1 | 1, from = this.#index): number | undefined {
    for (let index = from + dir; this.#canGoToIndex(index); index += dir)
      if (this.sections[index]?.linear !== "no") return index;
  }
  async #turnPage(dir: -1 | 1, distance?: number, context: object = {}) {
    if (this.#locked) return;
    this.#locked = true;
    try {
      const prev = dir === -1;
      const shouldGo = await (prev ? this.#scrollPrev(distance, context) : this.#scrollNext(distance, context));
      if (shouldGo) await this.#goToAdjacent(dir, context);
      if (shouldGo || !this.hasAttribute("animated")) await wait(100);
    } finally {
      this.#locked = false;
    }
  }
  async #goToAdjacent(dir: -1 | 1, context: object = {}) {
    const edge = this.scrolled
      ? dir < 0
        ? this.#entries[0]
        : this.#entries.at(-1)
      : this.#entries.find((entry) => entry.view === this.#view);
    if (edge?.view.turnChapter(dir)) {
      const navigation = ++this.#navigation;
      this.#building = navigation;
      // Same-file chapter turns swap the scroll surface too; keep the
      // old momentum layer retired until the new chapter is anchored.
      const resumeScroll = this.suspendScroll();
      try {
        this.#keepEntry(edge);
        this.#updateChapterEdges();
        this.#activate(edge, context, true);
        await this.#scrollToAnchor(dir < 0 ? 1 : 0, "navigation", context);
      } finally {
        resumeScroll();
        this.#finishBuild(navigation);
        if (navigation === this.#navigation) void this.#maintainWindow(context);
      }
      return;
    }
    const index = this.#adjacentIndex(dir, edge?.index);
    if (index !== undefined) {
      await this.#goTo({ index, anchor: dir < 0 ? 1 : 0, context });
      return;
    }
    // READAWARE: a turn with nowhere to go — past the last page or before
    // the first — is the reader pushing against the book's edge. Touch
    // swipes reach here through snap() without passing the host's own turn
    // routing, so the host learns of it from the engine.
    this.dispatchEvent(new CustomEvent<EdgeDetail>("edge", { detail: { dir, context } }));
  }
  prev(distance?: number, context?: object) {
    return this.#turnPage(-1, distance, context);
  }
  next(distance?: number, context?: object) {
    return this.#turnPage(1, distance, context);
  }
  prevSection() {
    const index = this.#adjacentIndex(-1);
    return this.goTo(index === undefined ? undefined : { index });
  }
  nextSection() {
    const index = this.#adjacentIndex(1);
    return this.goTo(index === undefined ? undefined : { index });
  }
  firstSection() {
    const index = this.sections.findIndex((section) => section.linear !== "no");
    return this.goTo({ index });
  }
  lastSection() {
    const index = this.sections.findLastIndex((section) => section.linear !== "no");
    return this.goTo({ index });
  }
  getContents(): Content[] {
    // Keep the reading-position document first for existing consumers;
    // annotations and selection can address every resident source document.
    const entries = [...this.#entries].sort((a, b) => Number(b.view === this.#view) - Number(a.view === this.#view));
    return entries.flatMap(({ index, view }) =>
      view.ready && view.document ? [{ index, overlayer: view.overlayer, doc: view.document }] : [],
    );
  }
  setStyles(styles: Styles, context: object = {}) {
    this.#styles = styles;
    this.#styleRevision++;
    this.#anchorContext = context;
    for (const { view } of this.#entries) this.#applyStyles(view);
  }
  #applyStyles(view: SectionView) {
    const doc = view.document;
    if (!doc) return;
    const $$styles = this.#styleMap.get(doc);
    if (!$$styles) return;
    const [$beforeStyle, $style] = $$styles;
    const [before, after] = Array.isArray(this.#styles) ? this.#styles : ["", this.#styles ?? ""];
    if ($beforeStyle.textContent === before && $style.textContent === after) return;
    const revision = this.#styleRevision;
    $beforeStyle.textContent = before;
    $style.textContent = after;

    // NOTE: needs `requestAnimationFrame` in Chromium
    requestAnimationFrame(() => {
      if (this.#entries.some((entry) => entry.view === view) && revision === this.#styleRevision) {
        if (this.#view === view) this.#background.style.background = getBackground(doc);
        view.refreshStyles();
      }
    });

    // needed because the resize observer doesn't work in Firefox
    void doc.fonts?.ready
      .then(() => {
        if (this.#entries.some((entry) => entry.view === view) && revision === this.#styleRevision)
          view.refreshStyles();
      })
      .catch((error: unknown) => console.warn("Could not refresh styles after fonts loaded", error));
  }
  focusView(context: object = {}) {
    const doc = this.#view?.document;
    if (!doc) return;
    if (this.inputBridge) this.inputBridge.focusDocument(doc, context);
    else doc.defaultView?.focus();
  }
  destroy() {
    this.#inputRevision++;
    this.#focusRequest = undefined;
    this.inputBridge = undefined;
    this.#styleRevision++;
    this.#navigation++;
    this.#transformController?.abort();
    this.#observer.disconnect();
    this.#keepEntry();
    this.#extending = {};
    this.#building = undefined;
    this.#deferredLayout = false;
    this.#mediaQuery.removeEventListener("change", this.#mediaQueryListener);
  }
}

customElements.define("foliate-paginator", Paginator);
