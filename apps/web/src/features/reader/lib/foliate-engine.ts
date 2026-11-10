/**
 * Type-only contracts come from the canonical engine sources. Runtime modules
 * stay under /foliate-js/ so PDF workers and other relative assets remain static.
 */
import type { StoredBookSource } from "./reader-types";
import type { Book as FoliateBook, LanguageMap as FoliateLanguageMap } from "../../../../foliate-js/src/book";
import type { View as FoliateView, Renderer as FoliateRenderer } from "../../../../foliate-js/src/view";
import type { EngineAPI } from "../../../../foliate-js/src/engine-api";
import type { DrawFunction } from "../../../../foliate-js/src/overlayer";
import { buildChapterMap, type ChapterMap } from "../../../../foliate-js/src/chapter-map";

export type { FoliateBook, FoliateLanguageMap, FoliateView, FoliateRenderer };
export type {
  BookMetadata as FoliateMetadata,
  TOCItem as FoliateTocItem,
  ResolvedNavigation as FoliateResolved,
} from "../../../../foliate-js/src/book";
export type {
  RelocateReason as FoliateRelocateReason,
  LoadDetail as FoliateLoadDetail,
  Content as FoliateContent,
  EdgeDetail as FoliateEdgeDetail,
} from "../../../../foliate-js/src/renderer";
export type {
  Annotation as FoliateAnnotation,
  DrawAnnotationDetail as FoliateDrawAnnotationDetail,
  ShowAnnotationDetail as FoliateShowAnnotationDetail,
  LinkDetail as FoliateLinkDetail,
  ViewRelocateDetail as FoliateRelocateDetail,
} from "../../../../foliate-js/src/view";
export type {
  FootnoteHandler as FoliateFootnoteHandler,
  FootnoteRenderDetail as FoliateFootnoteRenderDetail,
  FootnoteBeforeRenderDetail as FoliateFootnoteBeforeRenderDetail,
} from "../../../../foliate-js/src/footnotes";
import type { FootnoteHandler as FoliateFootnoteHandler } from "../../../../foliate-js/src/footnotes";
export type { Overlayer as FoliateOverlayer } from "../../../../foliate-js/src/overlayer";
export type { ChapterMap, ChapterMapEntry } from "../../../../foliate-js/src/chapter-map";
export type FoliateHighlightFn = DrawFunction;
export type FoliateDrawFns = Pick<EngineAPI["Overlayer"], "highlight" | "underline">;
const FOLIATE_BASE = "/foliate-js";
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

let enginePromise: Promise<EngineAPI> | null = null;

function readEngineGlobal(): EngineAPI | undefined {
  return globalThis.__readawareFoliate;
}

function loadEngine(): Promise<EngineAPI> {
  if (enginePromise) return enginePromise;
  enginePromise = new Promise<EngineAPI>((resolve, reject) => {
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
    script.addEventListener("error", () => reject(new Error("Failed to load the reading engine.")));
    document.head.append(script);
  });
  // Don't cache a failure: drop the promise so the next open (or the idle
  // warmup) retries with a fresh script tag instead of replaying the rejection.
  enginePromise.catch(() => {
    enginePromise = null;
  });
  return enginePromise;
}

export async function loadContentNavigation(): Promise<
  Pick<EngineAPI, "contentCFI" | "searchContentSection" | "resolveTextQuote" | "readContentRange">
> {
  const { contentCFI, searchContentSection, resolveTextQuote, readContentRange } = await loadEngine();
  return { contentCFI, searchContentSection, resolveTextQuote, readContentRange };
}

/**
 * Kick off the engine's script-injection load without needing it yet — called
 * from the idle warmup so the first book open doesn't pay for fetching the
 * whole vendored module tree. Failures are swallowed; a real open retries.
 */
export function preloadFoliateEngine(): void {
  // Warmup only: the next real open loads the engine again and reports its failure.
  void loadEngine().catch(() => {});
}

/** The overlay draw functions (`highlight`, `underline`) for `draw-annotation`. */
export async function loadDrawFns(): Promise<FoliateDrawFns> {
  const { Overlayer } = await loadEngine();
  return { highlight: Overlayer.highlight, underline: Overlayer.underline };
}

/** Parse a book file into a foliate book object (auto-detects the format). */
export async function makeFoliateBook(file: StoredBookSource): Promise<FoliateBook> {
  return (await loadEngine()).makeBook(file);
}

const chapterMaps = new WeakMap<FoliateBook, Promise<ChapterMap>>();

/**
 * The book's chapters (see `foliate-js/src/chapter-map.ts`), computed once per
 * parsed book so the reader and the text extractor share one answer. Call it
 * after `ensureUsableToc`: the map reads the repaired navigation. The module is
 * a pure function over the parsed book, so it is imported directly rather than
 * through the engine loader, which exists for the DOM/worker runtime.
 */
export function chapterMapFor(book: FoliateBook): Promise<ChapterMap> {
  let map = chapterMaps.get(book);
  if (!map) {
    map = buildChapterMap(book);
    chapterMaps.set(book, map);
    // A failed build must not be served to the next caller.
    map.catch(() => chapterMaps.delete(book));
  }
  return map;
}

/** Create a fresh `<foliate-view>` element (engine modules are loaded first). */
export async function createFoliateView(): Promise<FoliateView> {
  const { View } = await loadEngine();
  return new View();
}

/** Create a footnote handler for resolving in-book footnote/endnote links. */
export async function createFootnoteHandler(): Promise<FoliateFootnoteHandler> {
  const { FootnoteHandler } = await loadEngine();
  return new FootnoteHandler();
}

const SCROLL_EDGE_EPSILON = 2;

/**
 * Whether there is genuinely nothing left to turn to.
 *
 * Asked of the renderer rather than inferred from progress: the engine already
 * knows whether another section follows, and it answers the same way in
 * paginated and scrolled flow. (Inferring it from `relocate` cannot work — that
 * event only fires when the position CHANGES, so it goes silent exactly at the
 * end, and a session restored there never receives one at all.)
 *
 * `atEnd` alone is too generous: it tolerates being two pages short, which would
 * finish the book while a page still remained. Its value is the part that is
 * hard to get otherwise — "no following section" — so it gates the check, and
 * the page comparison supplies the precision.
 */
/**
 * Whether the reader is showing the book's last page, so advancing means
 * finishing. The renderer's `atEnd` already answers precisely: in paginated
 * flow a document is laid out with one blank spacer column at each end, so its
 * last text page is `pages - 2` (the value `atEnd` tests), and `pages - 1` is
 * the trailing spacer no reader ever rests on. Tightening the test to that
 * spacer made finishing unreachable.
 */
export function isAtEndOfBook(view: FoliateView | null | undefined): boolean {
  const renderer = view?.renderer;
  return !!renderer && "atEnd" in renderer && renderer.atEnd === true;
}

/**
 * Whether the continuous-scroll viewport is at the top/bottom of the current
 * section. Returns null when not in scrolled mode or geometry is unavailable.
 */
export function getScrollEdges(view: FoliateView | null | undefined): { atTop: boolean; atBottom: boolean } | null {
  const renderer = view?.renderer;
  if (!renderer?.scrolled) return null;
  try {
    const start = renderer.start ?? 0;
    const end = renderer.end ?? 0;
    const viewSize = renderer.viewSize ?? 0;
    // A resident edge with chapter sources still to load is not an edge the
    // reader can push past; the engine fills it in as they approach.
    const pending = (dir: -1 | 1) => "hasPendingContent" in renderer && renderer.hasPendingContent(dir);
    return {
      atTop: start <= SCROLL_EDGE_EPSILON && !pending(-1),
      atBottom: viewSize - end <= SCROLL_EDGE_EPSILON && !pending(1),
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

export function foliateTitle(book: Pick<FoliateBook, "metadata">): string {
  return firstLanguageValue(book.metadata?.title).trim();
}

export function foliateAuthor(book: Pick<FoliateBook, "metadata">): string {
  const author = book.metadata?.author;
  if (!author) return "";
  const one = (contributor: string | { name?: string | FoliateLanguageMap }): string =>
    typeof contributor === "string" ? contributor : firstLanguageValue(contributor?.name);
  if (Array.isArray(author)) {
    return author.map(one).filter(Boolean).join(", ").trim();
  }
  return one(author).trim();
}

/**
 * Fixed-layout by library FORMAT — decidable before the file is parsed, which
 * is what the reader needs to pick the reading-mode axis without reopening.
 * A pre-paginated EPUB is only detectable after parsing and deliberately
 * stays on the reflowable axis.
 */
export function isFixedLayoutFormat(format: string | null | undefined): boolean {
  return format === "pdf" || format === "cbz" || format === "cbr";
}

/** A book is fixed-layout (PDF/CBZ) when its rendition layout is pre-paginated. */
export function isFixedLayout(book: Pick<FoliateBook, "rendition">): boolean {
  return book.rendition?.layout === "pre-paginated";
}
