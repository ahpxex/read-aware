/**
 * 精简自 apps/web/src/features/reader/lib/foliate-engine.ts —— lab 只需要
 * 打开、翻页、进度、选区取 CFI。引擎经 public/foliate-js 软链复用产品的
 * vendored 树，脚本注入加载（不打包，理由见那边的 VENDOR.md）。
 */

const FOLIATE_LOADER_URL = "/foliate-js/loader.js";
const FOLIATE_GLOBAL_KEY = "__readawareFoliate";

export type FoliateRelocateDetail = {
  fraction?: number;
  cfi?: string;
  tocItem?: { label?: string } | null;
};

export type FoliateLoadDetail = { doc: Document; index: number };

export type FoliateView = HTMLElement & {
  open: (book: Blob | File | string) => Promise<void>;
  renderer?: {
    next: () => Promise<void> | void;
    setAttribute: (name: string, value: string) => void;
    setStyles?: (css: string) => void;
  };
  goLeft: () => Promise<void> | void;
  goRight: () => Promise<void> | void;
  goToFraction: (fraction: number) => Promise<void>;
  getCFI: (index: number, range: Range) => string;
};

let enginePromise: Promise<void> | null = null;

function loadEngine(): Promise<void> {
  if (enginePromise) return enginePromise;
  enginePromise = new Promise<void>((resolve, reject) => {
    if ((globalThis as Record<string, unknown>)[FOLIATE_GLOBAL_KEY]) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.type = "module";
    script.src = FOLIATE_LOADER_URL;
    script.addEventListener("load", () => {
      if ((globalThis as Record<string, unknown>)[FOLIATE_GLOBAL_KEY]) resolve();
      else reject(new Error("reading engine loaded but did not initialize"));
    });
    script.addEventListener("error", () => reject(new Error("failed to load reading engine")));
    document.head.append(script);
  });
  return enginePromise;
}

export async function createFoliateView(): Promise<FoliateView> {
  await loadEngine();
  return document.createElement("foliate-view") as FoliateView;
}

export type FoliateSection = {
  createDocument?: () => Promise<Document> | Document;
  linear?: string;
};

export type FoliateBook = {
  metadata?: unknown;
  toc?: Array<{ label?: string; href?: string }> | null;
  sections?: FoliateSection[];
};

/** 解析书文件为 foliate book 对象（离屏，不渲染）—— 正文抽取用。 */
export async function makeFoliateBook(file: Blob | File): Promise<FoliateBook> {
  await loadEngine();
  const engine = (globalThis as Record<string, unknown>)[FOLIATE_GLOBAL_KEY] as {
    makeBook: (file: Blob | File) => Promise<FoliateBook>;
  };
  return engine.makeBook(file);
}
