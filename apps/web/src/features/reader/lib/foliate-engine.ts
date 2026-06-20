/**
 * Typed loader + thin wrapper around the vendored foliate-js engine.
 *
 * foliate-js is served as a static ES-module tree from `public/foliate-js` (see
 * that folder's VENDOR.md for why it is not bundled). We import it at runtime so
 * its relative parser imports and `import.meta.url` PDF asset resolution stay
 * correct in dev, production, and the Tauri webview. The engine is untyped JS,
 * so the interfaces below cover only the surface this app uses.
 */

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

export type FoliateRenderer = {
  setAttribute: (name: string, value: string) => void;
  setStyles?: (css: string) => void;
  next: () => Promise<void> | void;
  destroy?: () => void;
};

export type FoliateView = HTMLElement & {
  open: (book: Blob | File | string | FoliateBook) => Promise<void>;
  book?: FoliateBook;
  renderer?: FoliateRenderer;
  goTo: (target: string | number | FoliateResolved) => Promise<FoliateResolved | undefined>;
  goToFraction: (fraction: number) => Promise<void>;
  getCFI: (index: number, range: Range) => string;
  addAnnotation: (
    annotation: FoliateAnnotation,
    remove?: boolean,
  ) => Promise<{ index: number; label: string } | undefined>;
  deleteAnnotation: (annotation: FoliateAnnotation) => Promise<unknown>;
};

export type FoliateHighlightFn = unknown;

type FoliateGlobal = {
  makeBook: (file: Blob | File | string) => Promise<FoliateBook>;
  Overlayer: { highlight: FoliateHighlightFn };
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
  return enginePromise;
}

/** The `Overlayer.highlight` draw function used by the `draw-annotation` event. */
export async function loadHighlightDrawFn(): Promise<FoliateHighlightFn> {
  return (await loadEngine()).Overlayer.highlight;
}

/** Parse a book file into a foliate book object (auto-detects the format). */
export async function makeFoliateBook(file: Blob | File): Promise<FoliateBook> {
  return (await loadEngine()).makeBook(file);
}

/** Create a fresh `<foliate-view>` element (engine modules are loaded first). */
export async function createFoliateView(): Promise<FoliateView> {
  await loadEngine();
  return document.createElement("foliate-view") as FoliateView;
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
