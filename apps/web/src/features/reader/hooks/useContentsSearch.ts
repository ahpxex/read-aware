import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BookLocationHit, BookLocationSearchPage, BookNavigationTargetEntry } from "@read-aware/core";
import { createLibraryDomain } from "../../../domain/library";
import { readingRuntime } from "../../../domain/reading-runtime";
import { createLogger } from "../../../platform/logger";
import { createSearchSession } from "../lib/book-search-memory";
import { chapterTitleHits, isPageLabelQuery, sectionChapterLabels, wantsMatchCase } from "../lib/contents-search";

const log = createLogger("contents-search");

/** Typing settles for this long before the book's text is searched. */
const SETTLE_MS = 250;
/** Text hits shown at most; the search stops paging once it has them. Hits
 *  that only repeat a listed chapter's title are not shown and do not count. */
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
 * Finished searches, chapter names and where each result list was left, for
 * this run of the app (see lib/book-search-memory): reopening the search
 * shows the last results without searching the book again. A remembered
 * search holds every hit it read, title lines included: which of them repeat
 * a listed chapter is decided when they are shown, against the chapters
 * listed then.
 */
export const bookSearchSession = createSearchSession<Omit<ContentsSearchState, "chapterOf">>();

/**
 * The asynchronous half of the contents search — printed page labels and the
 * book's full text — for a settled query. Pages of text hits stream in as
 * they arrive; a new query, a closed panel or another book abort the search.
 * A query this run has already searched to the end answers from memory.
 *
 * `chapterTitles` are the titles of the chapters the results already list for
 * this query. A text hit on a line that is one of those titles (the chapter's
 * heading, its line on a contents page) is that chapter again, not the book's
 * text, and is left out of `text.hits`.
 */
export function useContentsSearch(
  bookId: string,
  query: string,
  active: boolean,
  chapterTitles: readonly string[],
): ContentsSearchState {
  const library = useMemo(() => createLibraryDomain("user"), []);
  const isChapterTitle = useMemo(() => chapterTitleHits(chapterTitles), [chapterTitles]);
  // The running search counts shown hits against the limit by the chapters
  // listed now, without restarting when that list changes.
  const latestIsChapterTitle = useRef(isChapterTitle);
  useLayoutEffect(() => {
    latestIsChapterTitle.current = isChapterTitle;
  });
  const [state, setState] = useState<{ key: string; value: ContentsSearchState }>({ key: "", value: IDLE });
  const trimmed = query.trim();

  // Text hits name their chapter: read the book's navigation contents once.
  const [chapters, setChapters] = useState<{ bookId: string; of: (sectionIndex: number) => string | undefined }>();
  const chapterOf = chapters?.bookId === bookId ? chapters.of : bookSearchSession.chapters.get(bookId);
  const knowsChapters = !!chapterOf;
  useEffect(() => {
    if (!active || knowsChapters) return;
    const controller = new AbortController();
    library.queries.books.getNavigationToc(bookId, controller.signal).then(
      (toc) => {
        if (controller.signal.aborted) return;
        const of = sectionChapterLabels(toc.entries);
        bookSearchSession.chapters.set(bookId, of);
        setChapters({ bookId, of });
      },
      (error: unknown) => {
        // Hits still show without their chapter names.
        if (!controller.signal.aborted) log.warn("reading the contents for search hits failed", error);
      },
    );
    return () => controller.abort();
  }, [active, bookId, knowsChapters, library]);
  const key = active && trimmed ? `${bookId}\u0000${trimmed}` : "";
  const recalled = key ? bookSearchSession.results.get(bookId, trimmed) : undefined;
  const isRecalled = !!recalled;

  useEffect(() => {
    if (!key || isRecalled) return;
    const controller = new AbortController();
    const { signal } = controller;
    let value: ContentsSearchState = IDLE;
    const publish = (next: ContentsSearchState) => {
      value = next;
      if (signal.aborted) return;
      // Remembered once the text has been searched to the end (a page label
      // answer arriving after that updates the remembered value).
      if (next.text.status === "done") bookSearchSession.results.set(bookId, trimmed, next);
      setState({ key, value: next });
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
      let shown = 0;
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
          const isTitle = latestIsChapterTitle.current;
          for (const hit of page.hits) if (!isTitle(hit)) shown++;
          const full = shown >= TEXT_HIT_LIMIT;
          const more = !!page.nextCursor && !full;
          publish({
            ...value,
            text: {
              status: more ? "searching" : "done",
              hits: [...hits],
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
        publish({ ...value, text: { status: "error", error, hits: [...hits] } });
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
  }, [key, isRecalled, bookId, trimmed, library]);

  const value = !key ? IDLE : state.key === key ? state.value : (recalled ?? IDLE);
  return useMemo(() => {
    const text =
      value.text.status === "idle"
        ? value.text
        : { ...value.text, hits: value.text.hits.filter((hit) => !isChapterTitle(hit)).slice(0, TEXT_HIT_LIMIT) };
    return { ...value, text, chapterOf };
  }, [value, chapterOf, isChapterTitle]);
}
