import { AppError, type BookLocationSearch, type BookLocationSearchPage, type BookNavigationToc, type BookTocEntry } from "@read-aware/core";
import type { FoliateBook, FoliateTocItem } from "../../reader/lib/foliate-engine";
import type { searchContentSection } from "../../../../foliate-js/src/content-navigation";
import { digestContent } from "./content-version";

type Cursor = { version: string; query: string; section: number; match: number; textSeen: boolean; supported: boolean; unsupported: boolean };
const invalidCursor = () => new AppError("library/invalid-cursor", "Search cursor does not match this query or content");
function decodeCursor(raw: string | undefined, version: string, query: string, sections: number): Cursor {
  if (!raw) return { version, query, section: 0, match: 0, textSeen: false, supported: false, unsupported: false };
  try {
    if (raw.length > 1024) throw invalidCursor();
    const cursor = JSON.parse(atob(raw)) as Cursor;
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || typeof cursor.version !== "string"
      || typeof cursor.query !== "string") throw invalidCursor();
    if (cursor.version !== version) throw new AppError("reader/stale-location", "Search cursor belongs to an older content revision");
    if (cursor.query !== query || !Number.isInteger(cursor.section) || cursor.section < 0 || cursor.section >= sections
      || !Number.isSafeInteger(cursor.match) || cursor.match < 0
      || typeof cursor.textSeen !== "boolean" || typeof cursor.supported !== "boolean" || typeof cursor.unsupported !== "boolean") throw invalidCursor();
    return cursor;
  } catch (error) { if (error instanceof AppError) throw error; throw invalidCursor(); }
}
const encodeCursor = (cursor: Cursor) => btoa(JSON.stringify(cursor));

export async function navigationToc(book: FoliateBook, bookId: string, contentVersion: string, signal?: AbortSignal): Promise<BookNavigationToc> {
  let ordinal = 0;
  const walk = async (entries: FoliateTocItem[], path: string): Promise<BookTocEntry[]> => {
    const result: BookTocEntry[] = [];
    for (const [index, entry] of entries.entries()) {
      signal?.throwIfAborted();
      const id = `${path}${index}`;
      const number = ++ordinal;
      const resolved = entry.href ? await book.resolveHref?.(entry.href) : undefined;
      const sectionIndex = resolved && Number.isInteger(resolved.index) && book.sections[resolved.index] ? resolved.index : null;
      result.push({ id, label: entry.label ?? "", ordinal: number, sectionIndex,
        location: sectionIndex === null || !entry.href ? null : { bookId, contentVersion, href: entry.href },
        children: await walk(entry.subitems ?? [], `${id}.`) });
    }
    return result;
  };
  return { bookId, contentVersion, entries: await walk(book.toc ?? [], "toc:") };
}

export function validateLocationSearch(input: BookLocationSearch): void {
  if (!input || typeof input.bookId !== "string" || !input.bookId || typeof input.query !== "string" || !input.query.trim() || input.query.length > 500) {
    throw new AppError("library/invalid-query", "Search requires a book and 1 to 500 query characters");
  }
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50
    || input.matchCase !== undefined && typeof input.matchCase !== "boolean"
    || input.wholeWords !== undefined && typeof input.wholeWords !== "boolean"
    || input.cursor !== undefined && (typeof input.cursor !== "string" || !input.cursor || input.cursor.length > 1024)
    || input.contentVersion !== undefined && (typeof input.contentVersion !== "string" || !input.contentVersion)
    || input.hrefs !== undefined && (!Array.isArray(input.hrefs) || input.hrefs.length > 10000
      || input.hrefs.some(href => typeof href !== "string" || href.length > 8192))) {
    throw new AppError("library/invalid-query", "Search bounds are invalid");
  }
}

/** Pagination operates on a leased immutable revision; the host owns the lease. */
export async function searchLocationsInBook(book: FoliateBook, contentVersion: string, input: BookLocationSearch,
  searchSection: typeof searchContentSection, signal?: AbortSignal): Promise<BookLocationSearchPage> {
    validateLocationSearch(input);
    signal?.throwIfAborted();
    if (input.contentVersion && input.contentVersion !== contentVersion) throw new AppError("reader/stale-location", "Book content revision changed");
    const limit = input.limit ?? 20;
    const indices = new Set<number>();
    if (input.hrefs) {
      for (const href of input.hrefs) {
        signal?.throwIfAborted();
        const resolved = await book.resolveHref?.(href);
        if (resolved && book.sections[resolved.index]) indices.add(resolved.index);
        // Extracted chapter hrefs also carry canonical spine ids.
        const index = book.sections.findIndex(section => section.id === href);
        if (index >= 0) indices.add(index);
      }
    } else book.sections.forEach((section, index) => { if (section.linear !== "no") indices.add(index); });
    const sections = [...indices].sort((a, b) => a - b);
    const query = input.query.trim();
    const key = await digestContent(JSON.stringify([input.bookId, query, input.matchCase === true, input.wholeWords === true, sections]));
    const cursor = decodeCursor(input.cursor, contentVersion, key, sections.length);
    const result: BookLocationSearchPage = { bookId: input.bookId, contentVersion, hits: [], nextCursor: null,
      textStatus: sections.length ? "unsupported" : "unsearched", scannedSections: cursor.section, totalSections: sections.length };
    let { supported, unsupported, textSeen } = cursor;
    const continuation = (section: number, match: number) => encodeCursor({ version: contentVersion, query: key, section, match, textSeen, supported, unsupported });
    for (let position = cursor.section; position < sections.length; position++) {
      signal?.throwIfAborted();
      const sectionIndex = sections[position];
      const section = book.sections[sectionIndex];
      supported ||= !!(section.createDocument || section.getText);
      unsupported ||= !(section.createDocument || section.getText);
      let match = 0;
      for await (const hit of searchSection(book, sectionIndex, query,
        { matchCase: input.matchCase, matchDiacritics: true, matchWholeWords: input.wholeWords }, signal)) {
        if ("textLength" in hit) { textSeen ||= hit.textLength > 0; continue; }
        const ordinal = match++;
        if (position === cursor.section && ordinal < cursor.match) continue;
        if (result.hits.length === limit) {
          result.nextCursor = continuation(position, ordinal);
          break;
        }
        result.hits.push({ id: `${sectionIndex}:${ordinal}`, sectionIndex, excerpt: hit.excerpt,
          location: { bookId: input.bookId, contentVersion, cfi: hit.cfi, ...(hit.textQuote ? { textQuote: hit.textQuote } : {}) } });
      }
      result.scannedSections = position + (result.nextCursor ? 0 : 1);
      if (result.nextCursor) break;
      if (position - cursor.section >= 31 && position + 1 < sections.length) {
        result.nextCursor = continuation(position + 1, 0);
        break;
      }
    }
    if (sections.length) result.textStatus = textSeen ? "available" : result.nextCursor || supported && unsupported ? "partial" : supported ? "textless" : "unsupported";
    signal?.throwIfAborted();
    return result;
}
