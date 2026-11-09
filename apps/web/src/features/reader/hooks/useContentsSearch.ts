import { useEffect, useMemo, useState } from "react";
import type { BookLocationHit, BookLocationSearchPage, BookNavigationTargetEntry } from "@read-aware/core";
import { createLibraryDomain } from "../../../domain/library";
import { readingRuntime } from "../../../domain/reading-runtime";
import { createLogger } from "../../../platform/logger";
import { isPageLabelQuery, sectionChapterLabels, wantsMatchCase } from "../lib/contents-search";

const log = createLogger("contents-search");

/** Typing settles for this long before the book's text is searched. */
const SETTLE_MS = 250;
/** Text hits shown at most; the search stops paging once it has them. */
export const TEXT_HIT_LIMIT = 200;
const PAGE_SIZE = 20;
const PAGE_ROWS = 10;

export type TextSearchState =
  | { status: "idle" }
  | {
      status: "searching" | "done";
      hits: BookLocationHit[];
      scannedSections: number;
      totalSections: number;
      textStatus: BookLocationSearchPage["textStatus"];
      /** Stopped at TEXT_HIT_LIMIT with more of the book unscanned. */
      truncated: boolean;
    }
  | { status: "error"; error: unknown; hits: BookLocationHit[] };

export type ContentsSearchState = {
  /** Printed pages whose label is the query (books with a page list). */
  pages: BookNavigationTargetEntry[];
  text: TextSearchState;
  /** The chapter a text hit's section belongs to, once the contents are read. */
  chapterOf?: (sectionIndex: number) => string | undefined;
};

const IDLE: ContentsSearchState = { pages: [], text: { status: "idle" } };

/**
 * The asynchronous half of the contents search — printed page labels and the
 * book's full text — for a settled query. Pages of text hits stream in as
 * they arrive; a new query, a closed panel or another book abort the search.
 */
export function useContentsSearch(bookId: string, query: string, active: boolean): ContentsSearchState {
  const library = useMemo(() => createLibraryDomain("user"), []);
  const [state, setState] = useState<{ key: string; value: ContentsSearchState }>({ key: "", value: IDLE });
  const trimmed = query.trim();

  // Text hits name their chapter: read the book's navigation contents once.
  const [chapters, setChapters] = useState<{ bookId: string; of: (sectionIndex: number) => string | undefined }>();
  const chaptersBook = chapters?.bookId;
  useEffect(() => {
    if (!active || chaptersBook === bookId) return;
    const controller = new AbortController();
    library.queries.books.getNavigationToc(bookId, controller.signal).then(
      (toc) => {
        if (!controller.signal.aborted) setChapters({ bookId, of: sectionChapterLabels(toc.entries) });
      },
      (error: unknown) => {
        // Hits still show without their chapter names.
        if (!controller.signal.aborted) log.warn("reading the contents for search hits failed", error);
      },
    );
    return () => controller.abort();
  }, [active, bookId, chaptersBook, library]);
  const chapterOf = chapters?.bookId === bookId ? chapters.of : undefined;
  const key = active && trimmed ? `${bookId}\u0000${trimmed}` : "";

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const { signal } = controller;
    let value: ContentsSearchState = IDLE;
    const publish = (next: ContentsSearchState) => {
      value = next;
      if (!signal.aborted) setState({ key, value: next });
    };

    const searchPages = async () => {
      const contentVersion = readingRuntime.snapshot().location?.contentVersion;
      if (!isPageLabelQuery(trimmed) || !contentVersion) return;
      try {
        const page = await library.queries.books.listNavigationTargets(
          { bookId, contentVersion, kind: "pages", label: trimmed, limit: PAGE_ROWS },
          signal,
        );
        if (page.status !== "absent") publish({ ...value, pages: page.items.filter((item) => item.location) });
      } catch (error) {
        // A page list that cannot be read only loses its rows: the chapters,
        // marks and text search still answer the same query.
        if (!signal.aborted) log.warn("page label lookup failed", error);
      }
    };

    const searchText = async () => {
      const hits: BookLocationHit[] = [];
      let cursor: string | undefined;
      let contentVersion: string | undefined;
      try {
        while (!signal.aborted) {
          const page = await library.queries.books.searchLocations(
            {
              bookId,
              query: trimmed,
              limit: PAGE_SIZE,
              matchCase: wantsMatchCase(trimmed),
              ...(cursor ? { cursor } : {}),
              ...(contentVersion ? { contentVersion } : {}),
            },
            signal,
          );
          contentVersion = page.contentVersion;
          hits.push(...page.hits);
          const full = hits.length >= TEXT_HIT_LIMIT;
          const more = !!page.nextCursor && !full;
          publish({
            ...value,
            text: {
              status: more ? "searching" : "done",
              hits: hits.slice(0, TEXT_HIT_LIMIT),
              scannedSections: page.scannedSections,
              totalSections: page.totalSections,
              textStatus: page.textStatus,
              truncated: full && !!page.nextCursor,
            },
          });
          if (!more) return;
          cursor = page.nextCursor!;
        }
      } catch (error) {
        if (signal.aborted) return;
        log.warn("contents text search failed", error);
        publish({ ...value, text: { status: "error", error, hits: hits.slice(0, TEXT_HIT_LIMIT) } });
      }
    };

    const timer = window.setTimeout(() => {
      publish({
        pages: [],
        text: {
          status: "searching",
          hits: [],
          scannedSections: 0,
          totalSections: 0,
          textStatus: "unsearched",
          truncated: false,
        },
      });
      void searchPages();
      void searchText();
    }, SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, bookId, trimmed, library]);

  const value = key && state.key === key ? state.value : IDLE;
  return useMemo(() => ({ ...value, chapterOf }), [value, chapterOf]);
}
