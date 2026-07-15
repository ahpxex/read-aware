/**
 * Typed loader + thin wrapper around the vendored foliate-js engine.
 *
 * foliate-js is served as a static ES-module tree from `public/foliate-js` (see
 * that folder's VENDOR.md for why it is not bundled). We import it at runtime so
 * its relative parser imports and `import.meta.url` PDF asset resolution stay
 * correct in dev, production, and the Tauri webview. The engine is untyped JS,
 * so the interfaces below cover only the surface this app uses.
 */

import type { BookFileSource } from "./reader-types";

const FOLIATE_BASE = "/foliate-js";

// ---- Engine type surface (minimal, hand-written) ---------------------------

export type FoliateLanguageMap = Record<string, string>;

export type FoliateMetadata = {
  title?: string | FoliateLanguageMap;
  author?:
    | string
    | { name?: string | FoliateLanguageMap }
    | Array<string | { name?: string | FoliateLanguageMap }>;
  language?: unknown;
};

export type FoliateTocItem = {
  label?: string;
  href?: string;
  subitems?: FoliateTocItem[] | null;
};

export type FoliateBook = {
  metadata?: FoliateMetadata;
  toc?: FoliateTocItem[] | null;
  sections?: unknown[];
  rendition?: { layout?: string };
  dir?: string;
  getCover?: () => Promise<Blob | null> | Blob | null;
};

export type FoliateRelocateDetail = {
  fraction?: number;
  location?: { current?: number; total?: number };
  tocItem?: { href?: string; label?: string } | null;
  pageItem?: { label?: string } | null;
  cfi?: string;
  range?: Range;
  index?: number;
};

export type FoliateLoadDetail = { doc: Document; index: number };

export type FoliateAnnotation = { value: string; color?: string; [key: string]: unknown };

export type FoliateDrawAnnotationDetail = {
  draw: (func: unknown, options?: Record<string, unknown>) => void;
  annotation: FoliateAnnotation;
  doc: Document;
  range: Range;
};

export type FoliateShowAnnotationDetail = { value: string; index: number; range: Range };

export type FoliateResolved = { index: number; anchor: unknown };

export type FoliateOverlayer = {
  /** Returns `[cfiValue, range]` for an annotation under the point, else `[]`. */
  hitTest: (point: { x: number; y: number }) => [string, Range] | [];
  element: SVGElement;
};

export type FoliateContent = {
  index: number;
  overlayer?: FoliateOverlayer;
  doc?: Document;
};

export type FoliateRenderer = {
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  /** Atomically configure a fixed-layout renderer before its first navigation. */
  setLayout?: (flow: string, maxColumnCount: number) => void;
  setStyles?: (css: string) => void;
  next: () => Promise<void> | void;
  destroy?: () => void;
  /** Currently-rendered section contents (each with its overlayer + document). */
  getContents?: () => FoliateContent[];
  /** Bring an in-section anchor into view: flips to its page when paginated,
   *  scrolls its start to the viewport top in scrolled mode. */
  scrollToAnchor?: (anchor: Range | Element | number) => Promise<void> | void;
  /** True while the paginator runs the continuous-scroll flow. */
  scrolled?: boolean;
};

export type FoliateView = HTMLElement & {
  open: (book: BookFileSource | string | FoliateBook) => Promise<void>;
  book?: FoliateBook;
  renderer?: FoliateRenderer;
  goTo: (target: string | number | FoliateResolved) => Promise<FoliateResolved | undefined>;
  goToFraction: (fraction: number) => Promise<void>;
  /** Turn to the next page; crosses into (and lazily loads) the next section at its end. */
  next: (distance?: number) => Promise<void>;
  /** Turn to the previous page; crosses into the previous section at its start. */
  prev: (distance?: number) => Promise<void>;
  /** Direction-aware page turn (maps to next/prev based on the book's reading direction). */
  goLeft: () => Promise<void> | void;
  goRight: () => Promise<void> | void;
  getCFI: (index: number, range: Range) => string;
  addAnnotation: (
    annotation: FoliateAnnotation,
    remove?: boolean,
  ) => Promise<{ index: number; label: string } | undefined>;
  deleteAnnotation: (annotation: FoliateAnnotation) => Promise<unknown>;
};

export type FoliateHighlightFn = unknown;

/** `link` event detail emitted by `<foliate-view>` for an in-book link click. */
export type FoliateLinkDetail = { a: HTMLAnchorElement; href: string };

/** `render` event detail from `FootnoteHandler` once a footnote is extracted. */
export type FoliateFootnoteRenderDetail = {
  /** A detached `<foliate-view>` holding the rendered footnote fragment. */
  view: FoliateView;
  href: string;
  /** `footnote` | `endnote` | `note` | `definition` | `biblioentry` | null. */
  type: string | null;
  hidden: boolean;
  target: Element | null;
};

/** `before-render` detail — fires before the footnote fragment is laid out. */
export type FoliateFootnoteBeforeRenderDetail = { view: FoliateView };

/**
 * foliate-js footnote engine: given a `link` event, it decides whether the link
 * is a footnote/endnote reference, extracts the target fragment (loading another
 * section if needed), and dispatches `before-render` then `render` with a view
 * holding the content. Regular links are left to navigate normally.
 */
export interface FoliateFootnoteHandler extends EventTarget {
  detectFootnotes: boolean;
  handle: (book: FoliateBook, event: Event) => Promise<unknown> | undefined;
}

type FoliateGlobal = {
  makeBook: (file: BookFileSource | string) => Promise<FoliateBook>;
  Overlayer: { highlight: FoliateHighlightFn; underline: FoliateHighlightFn };
  FootnoteHandler: new () => FoliateFootnoteHandler;
};

/** The overlay draw functions used by the `draw-annotation` event. */
export type FoliateDrawFns = {
  highlight: FoliateHighlightFn;
  underline: FoliateHighlightFn;
};

// ---- Runtime loading -------------------------------------------------------
//
// foliate-js is served as static ES modules from `public/foliate-js`. Vite
// refuses to `import()` files under `public/` from source, and bundling them
// would break foliate's relative + `import.meta.url` asset resolution. So we
// load the engine by injecting an external module `<script>` pointing at a tiny
// loader shim that imports the engine and hangs its entry points off the global.
// A same-origin external module script also satisfies a strict `script-src
// 'self'` CSP.

const FOLIATE_LOADER_URL = `${FOLIATE_BASE}/loader.js`;
const FOLIATE_GLOBAL_KEY = "__readawareFoliate";

let enginePromise: Promise<FoliateGlobal> | null = null;

function readEngineGlobal(): FoliateGlobal | undefined {
  return (globalThis as unknown as Record<string, FoliateGlobal | undefined>)[FOLIATE_GLOBAL_KEY];
}

function loadEngine(): Promise<FoliateGlobal> {
  if (enginePromise) return enginePromise;
  enginePromise = new Promise<FoliateGlobal>((resolve, reject) => {
    const existing = readEngineGlobal();
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    script.type = "module";
    script.src = FOLIATE_LOADER_URL;
    script.addEventListener("load", () => {
      const engine = readEngineGlobal();
      if (engine) resolve(engine);
      else reject(new Error("The reading engine loaded but did not initialize."));
    });
    script.addEventListener("error", () =>
      reject(new Error("Failed to load the reading engine.")));
    document.head.append(script);
  });
  // Don't cache a failure: drop the promise so the next open (or the idle
  // warmup) retries with a fresh script tag instead of replaying the rejection.
  enginePromise.catch(() => {
    enginePromise = null;
  });
  return enginePromise;
}

/**
 * Kick off the engine's script-injection load without needing it yet — called
 * from the idle warmup so the first book open doesn't pay for fetching the
 * whole vendored module tree. Failures are swallowed; a real open retries.
 */
export function preloadFoliateEngine(): void {
  void loadEngine().catch(() => {});
}

/** The overlay draw functions (`highlight`, `underline`) for `draw-annotation`. */
export async function loadDrawFns(): Promise<FoliateDrawFns> {
  const { Overlayer } = await loadEngine();
  return { highlight: Overlayer.highlight, underline: Overlayer.underline };
}

/** Parse a book file into a foliate book object (auto-detects the format). */
export async function makeFoliateBook(file: BookFileSource): Promise<FoliateBook> {
  return (await loadEngine()).makeBook(file);
}

/** Create a fresh `<foliate-view>` element (engine modules are loaded first). */
export async function createFoliateView(): Promise<FoliateView> {
  await loadEngine();
  return document.createElement("foliate-view") as FoliateView;
}

/** Create a footnote handler for resolving in-book footnote/endnote links. */
export async function createFootnoteHandler(): Promise<FoliateFootnoteHandler> {
  const { FootnoteHandler } = await loadEngine();
  return new FootnoteHandler();
}

// The paginator renders into a *closed* shadow root, so its scroll container is
// unreachable from the app. Instead we read the renderer's public geometry
// getters (`start`/`end`/`viewSize`) to tell when continuous scroll has reached
// the top/bottom of the current section — the cue to lazily load the adjacent
// one. foliate is pinned vendor code (see public/foliate-js/VENDOR.md), so this
// coupling to its getter surface is acceptable.
type FoliateScrollGeometry = {
  scrolled?: boolean;
  start?: number;
  end?: number;
  viewSize?: number;
};

const SCROLL_EDGE_EPSILON = 2;

/**
 * Whether the continuous-scroll viewport is at the top/bottom of the current
 * section. Returns null when not in scrolled mode or geometry is unavailable.
 */
export function getScrollEdges(
  view: FoliateView | null | undefined,
): { atTop: boolean; atBottom: boolean } | null {
  const renderer = view?.renderer as unknown as FoliateScrollGeometry | undefined;
  if (!renderer?.scrolled) return null;
  try {
    const start = renderer.start ?? 0;
    const end = renderer.end ?? 0;
    const viewSize = renderer.viewSize ?? 0;
    return {
      atTop: start <= SCROLL_EDGE_EPSILON,
      atBottom: viewSize - end <= SCROLL_EDGE_EPSILON,
    };
  } catch {
    return null;
  }
}

// ---- Metadata normalizers (title/author may be language maps) --------------

function firstLanguageValue(value: string | FoliateLanguageMap | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  const keys = Object.keys(value);
  return keys.length ? value[keys[0]] : "";
}

export function foliateTitle(book: FoliateBook): string {
  return firstLanguageValue(book.metadata?.title).trim();
}

export function foliateAuthor(book: FoliateBook): string {
  const author = book.metadata?.author;
  if (!author) return "";
  const one = (
    contributor: string | { name?: string | FoliateLanguageMap },
  ): string =>
    typeof contributor === "string"
      ? contributor
      : firstLanguageValue(contributor?.name);
  if (Array.isArray(author)) {
    return author.map(one).filter(Boolean).join(", ").trim();
  }
  return one(author).trim();
}

/** A book is fixed-layout (PDF/CBZ) when its rendition layout is pre-paginated. */
export function isFixedLayout(book: FoliateBook): boolean {
  return book.rendition?.layout === "pre-paginated";
}
