import { AppError, BOOK_IMAGE_MAX_BYTES, normalizeBookImageQuery, normalizeBookImagesQuery,
  type BookImage, type BookImageQuery, type BookImagesPage, type BookImagesQuery } from "@read-aware/core";
import { loadContentNavigation, type FoliateBook } from "../../reader/lib/foliate-engine";
import type { contentCFI } from "../../../../foliate-js/src/content-navigation";
import { withBookContent } from "./book-content-source";
import { contentSections } from "./book-content-sections";

const selector = "img:not([zy-footnote]):not(.epub-footnote):not(.zhangyue-footnote), image";
export type BookImageData = { image: BookImage; status: "ready"; blob: Blob }
  | { image: BookImage; status: "missing" | "external" | "unsupported" };

async function documentFor(book: FoliateBook, index: number, allowed?: Set<number>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (allowed && !allowed.has(index)) throw new AppError("library/range-forbidden", "Image crosses the host reading fence");
  const section = book.sections[index];
  if (!section) throw new AppError("library/range-not-found", "Image section is missing");
  const doc = await section.createDocument?.();
  signal?.throwIfAborted(); return doc;
}
function describeImage(book: FoliateBook, query: BookImageQuery, element: Element, cfi: typeof contentCFI): BookImage {
  const range = element.ownerDocument.createRange();
  range.selectNode(element);
  return { image: { ...query.image }, alt: (element.getAttribute("alt") ?? element.getAttribute("aria-label") ?? "").slice(0, 300),
    location: { bookId: query.image.bookId, contentVersion: query.image.contentVersion, cfi: cfi(book, query.image.sectionIndex, range) } };
}
export async function listImagesInBook(book: FoliateBook, input: BookImagesQuery, cfi: typeof contentCFI,
  allowed?: Set<number>, signal?: AbortSignal): Promise<BookImagesPage> {
  const query = normalizeBookImagesQuery(input);
  const doc = await documentFor(book, query.sectionIndex, allowed, signal);
  const nodes = doc ? Array.from(doc.querySelectorAll(selector)) : [];
  if (query.offset > nodes.length) throw new AppError("library/invalid-query", "Image offset exceeds this section");
  const end = Math.min(nodes.length, query.offset + query.limit);
  return { bookId: query.bookId, contentVersion: query.contentVersion, sectionIndex: query.sectionIndex,
    status: doc ? "available" : "unsupported", total: nodes.length, nextOffset: end < nodes.length ? end : null,
    items: nodes.slice(query.offset, end).map((element, i) => describeImage(book, { image: {
      bookId: query.bookId, contentVersion: query.contentVersion, sectionIndex: query.sectionIndex, index: query.offset + i,
    } }, element, cfi)) };
}

/** Only inline data or the parser's private archive/record loader; never fetch a source URL. */
export async function readImageInBook(book: FoliateBook, input: BookImageQuery, cfi: typeof contentCFI,
  allowed?: Set<number>, signal?: AbortSignal): Promise<BookImageData> {
  const query = normalizeBookImageQuery(input), ref = query.image;
  let image: BookImage = { image: ref, alt: "" };
  const doc = await documentFor(book, ref.sectionIndex, allowed, signal);
  if (!doc) return { image, status: "unsupported" };
  const element = doc.querySelectorAll(selector)[ref.index];
  if (!element) return { image, status: "missing" };
  image = describeImage(book, query, element, cfi);
  const src = (element.getAttribute("src") ?? element.getAttribute("href")
    ?? element.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? "").trim();
  if (/^(?:https?:|\/\/)/i.test(src)) return { image, status: "external" };
  let blob: Blob | null;
  if (/^data:/i.test(src)) {
    const match = /^data:(image\/[\w.+-]+);base64,/i.exec(src);
    if (!match) return { image, status: "unsupported" };
    if (src.length > BOOK_IMAGE_MAX_BYTES * 2) throw new AppError("ui/invalid-target", "Embedded image exceeds the byte limit");
    try {
      const decoded = atob(src.slice(match[0].length).replace(/\s/g, ""));
      if (decoded.length > BOOK_IMAGE_MAX_BYTES) throw new Error("oversize");
      blob = new Blob([Uint8Array.from(decoded, char => char.charCodeAt(0))], { type: match[1].toLowerCase() });
    } catch { throw new AppError("ui/invalid-target", "Malformed or oversized inline image"); }
  } else {
    if (/[\u0000-\u001f\u007f]/.test(src) || /^(?!kindle:)[a-z][a-z\d+.-]*:/i.test(src)) return { image, status: "unsupported" };
    const load = book.sections[ref.sectionIndex].loadImage;
    if (!load) return { image, status: "unsupported" };
    try { blob = await load(element); }
    catch (cause) {
      signal?.throwIfAborted();
      if (cause instanceof AppError) throw cause;
      throw new AppError("library/content-unavailable", "Embedded image could not be loaded", { cause });
    }
  }
  signal?.throwIfAborted();
  if (!blob) return { image, status: "missing" };
  if (!blob.size || blob.size > BOOK_IMAGE_MAX_BYTES) throw new AppError("ui/invalid-target", "Image exceeds the byte limit or is empty");
  return { image, status: "ready", blob };
}
export function listBookImages(input: BookImagesQuery, signal?: AbortSignal, allowedHrefs?: readonly string[]) {
  const query = normalizeBookImagesQuery(input), hrefs = allowedHrefs && [...allowedHrefs];
  return withBookContent(query.bookId, query.contentVersion, signal, async ({ book }) => {
    const { contentCFI } = await loadContentNavigation();
    return listImagesInBook(book, query, contentCFI, hrefs === undefined ? undefined : await contentSections(book, hrefs, signal), signal);
  });
}
export function readBookImage(input: BookImageQuery, signal?: AbortSignal, allowedHrefs?: readonly string[]) {
  const query = normalizeBookImageQuery(input), hrefs = allowedHrefs && [...allowedHrefs];
  return withBookContent(query.image.bookId, query.image.contentVersion, signal, async ({ book }) => {
    const { contentCFI } = await loadContentNavigation();
    return readImageInBook(book, query, contentCFI, hrefs === undefined ? undefined : await contentSections(book, hrefs, signal), signal);
  });
}
