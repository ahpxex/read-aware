import { AppError, normalizeBookRangeQuery, type BookLocationHit } from "@read-aware/core";
import type { BookTextPort } from "../ports";
import type { ChapterSeed } from "./fixtures";

/** Model-tool fixture, not a replacement for Foliate's location/search tests. */
export function createMemoryBookNavigation(chapters: Map<string, ChapterSeed[]>): Pick<BookTextPort, "getNavigationToc" | "searchLocations" | "readRange"> {
  const content = async (bookId: string) => {
    const entries = chapters.get(bookId) ?? [];
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(entries)));
    const contentVersion = `fixture:${[...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
    return { entries, contentVersion };
  };
  return {
    readRange: async ({ throughChapterIndex, ...input }, signal) => {
      const query = normalizeBookRangeQuery(input);
      signal?.throwIfAborted();
      const { entries, contentVersion } = await content(query.range.bookId);
      if (contentVersion !== query.range.contentVersion) throw new AppError("reader/stale-location", "Fixture content changed");
      const match = /^epubcfi\(fixture:(\d+):(\d+):(\d+)\)$/.exec(query.range.cfi);
      if (!match) throw new AppError("library/range-not-found", "Unknown fixture range");
      const [sectionIndex, start, end] = match.slice(1).map(Number);
      if (throughChapterIndex !== undefined && sectionIndex > throughChapterIndex) throw new AppError("library/range-forbidden", "Fixture reading fence");
      const source = entries[sectionIndex]?.text;
      if (!source || end > source.length || end <= start) throw new AppError("library/range-not-found", "Missing fixture range");
      const text = source.slice(start, end);
      if (query.offset > text.length) throw new AppError("library/invalid-range", "Invalid fixture offset");
      const next = Math.min(text.length, query.offset + query.limit);
      signal?.throwIfAborted();
      return { range: query.range, sectionIndex, text: text.slice(query.offset, next), offset: query.offset, totalLength: text.length,
        nextOffset: next < text.length ? next : null,
        context: { before: source.slice(Math.max(0, start - query.contextChars), start), after: source.slice(end, end + query.contextChars) } };
    },
    getNavigationToc: async (bookId, signal) => {
      signal?.throwIfAborted();
      const { entries, contentVersion } = await content(bookId);
      signal?.throwIfAborted();
      return { bookId, contentVersion, entries: entries.map((chapter, index) => ({
        id: `toc:${index}`, label: chapter.title ?? "", ordinal: index + 1, sectionIndex: index, children: [],
        location: { bookId, contentVersion, href: chapter.hrefs?.[0] ?? `fixture:chapter:${index}` },
      })) };
    },
    searchLocations: async (input, signal) => {
      signal?.throwIfAborted();
      const { entries, contentVersion } = await content(input.bookId);
      if (input.contentVersion && input.contentVersion !== contentVersion) throw new AppError("reader/stale-location", "Fixture content changed");
      const limit = input.limit ?? 20;
      if (!input.query.trim() || input.query.length > 500 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new AppError("library/invalid-query", "Invalid fixture search");
      const key = JSON.stringify([input.bookId, contentVersion, input.query, !!input.matchCase, !!input.wholeWords, input.throughChapterIndex ?? null]);
      let offset = 0;
      if (input.cursor) {
        try {
          const cursor = JSON.parse(decodeURIComponent(atob(input.cursor)));
          if (cursor.key !== key || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) throw new Error("Invalid cursor");
          offset = cursor.offset;
        } catch { throw new AppError("library/invalid-cursor", "Fixture cursor does not match query"); }
      }
      const searchable = input.throughChapterIndex === undefined ? entries : entries.slice(0, Math.max(0, Math.floor(input.throughChapterIndex) + 1));
      const hits: BookLocationHit[] = [];
      const escaped = input.query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matcher = new RegExp(input.wholeWords ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped, input.matchCase ? "gu" : "giu");
      for (const [sectionIndex, chapter] of searchable.entries()) {
        signal?.throwIfAborted();
        for (const match of chapter.text.matchAll(matcher)) {
          const start = match.index, end = start + match[0].length;
          const range = { bookId: input.bookId, contentVersion, cfi: `epubcfi(fixture:${sectionIndex}:${start}:${end})` };
          hits.push({ id: `${sectionIndex}:${start}`, sectionIndex,
            excerpt: { pre: chapter.text.slice(Math.max(0, start - 50), start), match: match[0], post: chapter.text.slice(end, end + 50) },
            location: { ...range }, range,
          });
        }
      }
      return { bookId: input.bookId, contentVersion, hits: hits.slice(offset, offset + limit),
        nextCursor: hits.length > offset + limit ? btoa(encodeURIComponent(JSON.stringify({ key, offset: offset + limit }))) : null,
        textStatus: !searchable.length ? "unsearched" : searchable.some(chapter => chapter.text.trim()) ? "available" : "textless",
        scannedSections: searchable.length, totalSections: searchable.length };
    },
  };
}
