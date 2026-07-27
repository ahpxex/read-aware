/**
 * RAR comic archives (`.cbr`) as foliate books.
 *
 * The vendored engine reads `.cbz` because a ZIP reader is already in it; RAR
 * needs a decoder of its own, so this builds the same fixed-layout book shape
 * `comic-book.js` produces — page images and all — on top of libarchive (WASM,
 * in a worker, so decoding never blocks the reader).
 *
 * Pages are extracted one at a time, on demand: a scanned volume runs to
 * hundreds of megabytes and the reader only ever shows a spread.
 */
import { Archive } from "libarchive.js";
import { escapeHtml } from "./section-document";

/** Served as a static asset, like the reading engine — see its `VENDOR.md`. */
const WORKER_URL = "/libarchive/worker-bundle.js";

const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
  ".jxl",
  ".avif",
];

type ArchiveTree = { [name: string]: ArchiveTree };

let initialized = false;

function ensureInitialized() {
  if (initialized) return;
  Archive.init({ workerUrl: WORKER_URL });
  initialized = true;
}

/**
 * Flatten the archive's entry tree to full paths.
 *
 * libarchive.js reports entries as nested objects keyed by path segment, where
 * a leaf (a file) is an empty object — the `CompressedFile` instances its
 * types promise do not survive the worker boundary, so entries are read back
 * through `extractSingleFile` by path instead. Its flat `getFilesArray()`
 * returns nothing at all for entries at the archive root, which is exactly how
 * comics are packed.
 */
function collectPaths(tree: ArchiveTree, prefix: string, paths: string[]) {
  for (const [name, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (value && typeof value === "object" && Object.keys(value).length > 0) {
      collectPaths(value, path, paths);
    } else {
      paths.push(path);
    }
  }
}

const pageHtml = (src: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"></head>` +
  `<body style="margin: 0"><img src="${escapeHtml(src)}"></body></html>`;

export async function buildComicArchiveBook(file: File): Promise<unknown> {
  ensureInitialized();
  const archive = await Archive.open(file);
  const entries: string[] = [];
  collectPaths((await archive.getFilesObject()) as ArchiveTree, "", entries);

  const collator = new Intl.Collator([], { numeric: true });
  const pages = entries
    .filter((path) => {
      const lower = path.toLowerCase();
      return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
    })
    .sort(collator.compare);

  if (pages.length === 0) throw new Error("No supported image files in archive");

  const urls = new Map<number, string[]>();
  const load = async (index: number) => {
    const existing = urls.get(index);
    if (existing) return existing[1]!;
    const extracted = await archive.extractSingleFile(pages[index]!);
    const imageUrl = URL.createObjectURL(extracted);
    const pageUrl = URL.createObjectURL(new Blob([pageHtml(imageUrl)], { type: "text/html" }));
    urls.set(index, [imageUrl, pageUrl]);
    return pageUrl;
  };
  const unload = (index: number) => {
    urls.get(index)?.forEach((url) => URL.revokeObjectURL(url));
    urls.delete(index);
  };

  return {
    metadata: { title: file.name, author: "" },
    rendition: { layout: "pre-paginated" },
    sections: pages.map((path, index) => ({
      id: path,
      load: () => load(index),
      unload: () => unload(index),
      size: 1000,
    })),
    toc: pages.map((path) => ({ label: path, href: path })),
    resolveHref: (href: string) => ({ index: Math.max(0, pages.indexOf(href)) }),
    splitTOCHref: (href: string) => [href, null],
    getTOCFragment: (doc: Document) => doc.documentElement,
    getCover: () => archive.extractSingleFile(pages[0]!),
    destroy: () => {
      for (const index of [...urls.keys()]) unload(index);
      void archive.close();
    },
  };
}
