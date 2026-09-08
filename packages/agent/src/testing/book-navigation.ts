import { AppError, type BookLocationHit } from "@read-aware/core";
import type { BookTextPort } from "../ports";
import type { ChapterSeed } from "./fixtures";

/** Model-tool fixture, not a replacement for Foliate's location/search tests. */
export function createMemoryBookNavigation(chapters: Map<string, ChapterSeed[]>): Pick<BookTextPort, "getNavigationToc" | "searchLocations"> {
  const content = async (bookId: string) => {
    const entries = chapters.get(bookId) ?? [];
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(entries)));
    const contentVersion = `fixture:${[...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
    return { entries, contentVersion };
  };
  return {
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
          hits.push({ id: `${sectionIndex}:${start}`, sectionIndex,
            excerpt: { pre: chapter.text.slice(Math.max(0, start - 50), start), match: match[0], post: chapter.text.slice(end, end + 50) },
            location: { bookId: input.bookId, contentVersion, cfi: `fixture:chapter:${sectionIndex}:offset:${start}` },
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
