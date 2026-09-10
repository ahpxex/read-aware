import { AppError, normalizeBookReferenceQuery, normalizeBookReferencesQuery,
  type BookReferenceQuery, type BookReferencePreview, type BookReferencesQuery, type BookReferencesPage } from "@read-aware/core";
import { loadContentNavigation, type FoliateBook } from "../../reader/lib/foliate-engine";
import type { contentCFI } from "../../../../foliate-js/src/content-navigation";
import { withBookContent } from "./book-content-source";
import { contentSections } from "./book-content-sections";

const selector = 'a[href], a[*|href], img[zy-footnote], img.epub-footnote, img.zhangyue-footnote';
const inlineNote = (element: Element) => element.localName === "img";
const label = (element: Element) => (inlineNote(element) ? element.getAttribute("title") || "" : element.textContent || "").trim().slice(0, 300);
const noteText = (element: Element) => element.getAttribute("zy-footnote") ?? element.getAttribute("alt") ?? "";

async function documentFor(book: FoliateBook, index: number, allowed: Set<number> | undefined, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (allowed && !allowed.has(index)) throw new AppError("library/range-forbidden", "Reference crosses the host reading fence");
  const section = book.sections[index];
  if (!section) throw new AppError("library/range-not-found", "Reference section is missing");
  const doc = await section.createDocument?.();
  signal?.throwIfAborted();
  return doc;
}

export async function listReferencesInBook(book: FoliateBook, input: BookReferencesQuery, allowed?: Set<number>, signal?: AbortSignal): Promise<BookReferencesPage> {
  const query = normalizeBookReferencesQuery(input);
  const doc = await documentFor(book, query.sectionIndex, allowed, signal);
  const nodes = doc ? Array.from(doc.querySelectorAll(selector)) : [];
  if (query.offset > nodes.length) throw new AppError("library/invalid-query", "Reference offset exceeds the section");
  const end = Math.min(nodes.length, query.offset + query.limit);
  return { bookId: query.bookId, contentVersion: query.contentVersion, sectionIndex: query.sectionIndex,
    status: doc ? "available" : "unsupported", total: nodes.length, nextOffset: end < nodes.length ? end : null,
    items: nodes.slice(query.offset, end).map((element, index) => ({
      reference: { bookId: query.bookId, contentVersion: query.contentVersion, sectionIndex: query.sectionIndex, index: query.offset + index },
      kind: inlineNote(element) ? "inline-note" : "link", label: label(element),
    })) };
}

/** Host-only DOM resolution; both source and target are checked before reading their text. */
export async function readReferenceInBook(book: FoliateBook, input: BookReferenceQuery, cfi: typeof contentCFI,
  allowed?: Set<number>, signal?: AbortSignal): Promise<BookReferencePreview> {
  const query = normalizeBookReferenceQuery(input), ref = query.reference;
  const result: BookReferencePreview = { reference: ref, status: "missing", label: "", text: "",
    offset: query.offset, totalLength: 0, nextOffset: null };
  const source = await documentFor(book, ref.sectionIndex, allowed, signal);
  if (!source) return { ...result, status: "unsupported" };
  const element = source.querySelectorAll(selector)[ref.index];
  if (!element) return result;
  result.label = label(element);
  let text: string;
  if (inlineNote(element)) text = noteText(element);
  else {
    const href = element.getAttribute("href") ?? element.getAttributeNS("http://www.w3.org/1999/xlink", "href");
    if (!href || href.length > 8192) return result;
    // No URL loading here. Only the book parser may resolve internal destinations.
    if (/^(?:https?:|\/\/)/i.test(href.trim())) {
      try {
        const value = href.trim();
        const url = new URL(value.startsWith("//") ? `https:${value}` : value);
        if (url.username || url.password) return { ...result, status: "blocked" };
        return { ...result, status: "external", url: url.href };
      } catch { return { ...result, status: "blocked" }; }
    }
    if (/^(?:javascript|data|file|blob|vbscript|mailto|tel|ftp):/i.test(href.trim())) return { ...result, status: "blocked" };
    const resolvedHref = book.sections[ref.sectionIndex].resolveHref?.(href) ?? href;
    if (book.isExternal?.(resolvedHref)) return { ...result, status: "blocked" };
    const target = await book.resolveHref?.(resolvedHref);
    signal?.throwIfAborted();
    if (!target || !Number.isSafeInteger(target.index) || !book.sections[target.index]) return result;
    const doc = await documentFor(book, target.index, allowed, signal);
    if (!doc) return { ...result, status: "unsupported" };
    const resolvedAnchor = typeof target.anchor === "function" ? target.anchor(doc) : target.anchor;
    // EPUB uses numeric zero for an ordinary link to the start of a section.
    const anchor = resolvedAnchor === 0 ? doc.body ?? doc.documentElement : resolvedAnchor;
    if (target.anchor !== undefined && (anchor === null || anchor === undefined)) return result;
    if (typeof anchor === "number") return { ...result, status: "unsupported" };
    const range = anchor && "startContainer" in anchor ? anchor : doc.createRange();
    if (!anchor || !("startContainer" in anchor)) range.selectNodeContents(anchor ?? doc.body ?? doc.documentElement);
    if (range.commonAncestorContainer.ownerDocument !== doc && range.commonAncestorContainer !== doc) return result;
    const root = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer as Element : range.commonAncestorContainer.parentElement;
    if (root?.closest("script, style")) return { ...result, status: "blocked" };
    // Reading a detached copy cannot run scripts or alter the reader's source DOM.
    const fragment = range.cloneContents();
    fragment.querySelectorAll("script, style").forEach(node => node.remove());
    text = fragment.textContent ?? "";
    result.location = { bookId: ref.bookId, contentVersion: ref.contentVersion, cfi: cfi(book, target.index, range) };
  }
  signal?.throwIfAborted();
  if (query.offset > text.length || query.offset > 0 && /[\uD800-\uDBFF]/.test(text[query.offset - 1]) && /[\uDC00-\uDFFF]/.test(text[query.offset] ?? "")) {
    throw new AppError("library/invalid-query", "Preview offset exceeds text or splits a surrogate pair");
  }
  let end = Math.min(text.length, query.offset + query.limit);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
  return { ...result, status: "resolved", text: text.slice(query.offset, end), totalLength: text.length, nextOffset: end < text.length ? end : null };
}

export function listBookReferences(input: BookReferencesQuery, signal?: AbortSignal, allowedHrefs?: readonly string[]): Promise<BookReferencesPage> {
  const query = normalizeBookReferencesQuery(input), hrefs = allowedHrefs && [...allowedHrefs];
  return withBookContent(query.bookId, query.contentVersion, signal, async ({ book }) =>
    listReferencesInBook(book, query, hrefs === undefined ? undefined : await contentSections(book, hrefs, signal), signal));
}
export function readBookReference(input: BookReferenceQuery, signal?: AbortSignal, allowedHrefs?: readonly string[]): Promise<BookReferencePreview> {
  const query = normalizeBookReferenceQuery(input), hrefs = allowedHrefs && [...allowedHrefs];
  return withBookContent(query.reference.bookId, query.reference.contentVersion, signal, async ({ book }) => {
    const { contentCFI } = await loadContentNavigation();
    return readReferenceInBook(book, query, contentCFI, hrefs === undefined ? undefined : await contentSections(book, hrefs, signal), signal);
  });
}
