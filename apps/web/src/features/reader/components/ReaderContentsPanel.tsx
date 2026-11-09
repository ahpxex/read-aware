import { useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Bookmark, ReadingLocation } from "@read-aware/core";
import { Button, ScrollArea, SearchField, useToast } from "@read-aware/ui";
import { describeError, useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import type { Annotation } from "../../annotations";
import { useContentsSearch } from "../hooks/useContentsSearch";
import { useReaderFocusTarget } from "../hooks/useReaderFocusTarget";
import { matchAnnotations, matchBookmarks, matchChapters } from "../lib/contents-search";
import { goToReadingTarget } from "../lib/reader-bookmarks";
import type { TocEntry } from "../lib/reader-types";
import { ReaderContentsResults, type ContentsMatches } from "./ReaderContentsResults";
import { ReaderTocList } from "./ReaderTocList";

const log = createLogger("reader-contents");
const SCROLL_BODY = "pb-[calc(1rem+var(--ra-safe-bottom))]";

/**
 * The reader's left panel: the table of contents, or — opened from the
 * header's search — a search over everything in the open book: chapters,
 * printed pages, bookmarks, highlights and notes, and the text.
 */
export function ReaderContentsPanel({
  bookId,
  shown,
  searching,
  onSearchingChange,
  entries,
  activeIndex,
  annotations,
  bookmarks,
  onChapterSelect,
  onAnnotationSelect,
  onBookmarkSelect,
  onJumped,
}: {
  bookId: string;
  /** The panel is on screen (searches run and the current chapter is revealed only then). */
  shown: boolean;
  /** The panel shows the search instead of the contents. */
  searching: boolean;
  onSearchingChange: (searching: boolean) => void;
  entries: TocEntry[];
  activeIndex: number;
  annotations: Annotation[];
  bookmarks: Bookmark[];
  onChapterSelect?: (href: string) => void;
  onAnnotationSelect?: (cfiRange: string) => void;
  /** Resolves true once the reader has moved. */
  onBookmarkSelect: (bookmark: Bookmark) => Promise<boolean>;
  /** The reader moved somewhere from the panel (a phone sheet closes). */
  onJumped: () => void;
}) {
  const { toast } = useToast();
  const listRef = useRef<HTMLDivElement | null>(null);
  useReaderFocusTarget(bookId, "toc", listRef);

  // The overlay re-renders on every page turn; its callbacks are read through
  // a ref so the (possibly long) result rows are not rebuilt each time.
  const latest = useRef({ onChapterSelect, onAnnotationSelect, onBookmarkSelect, onJumped });
  useLayoutEffect(() => {
    latest.current = { onChapterSelect, onAnnotationSelect, onBookmarkSelect, onJumped };
  });
  const goToChapter = useCallback((href: string) => {
    latest.current.onChapterSelect?.(href);
    latest.current.onJumped();
  }, []);
  const goToMark = useCallback((cfiRange: string) => {
    latest.current.onAnnotationSelect?.(cfiRange);
    latest.current.onJumped();
  }, []);
  const goToLocation = useCallback(
    (location: ReadingLocation) => {
      goToReadingTarget(location).then(
        () => latest.current.onJumped(),
        (error: unknown) => {
          log.error("jumping to a search result failed", error);
          toast({ variant: "destructive", description: describeError(error).body });
        },
      );
    },
    [toast],
  );
  const openBookmark = useCallback((bookmark: Bookmark) => {
    void latest.current.onBookmarkSelect(bookmark).then((moved) => {
      if (moved) latest.current.onJumped();
    });
  }, []);

  if (searching)
    return (
      <ContentsSearch
        bookId={bookId}
        shown={shown}
        entries={entries}
        annotations={annotations}
        bookmarks={bookmarks}
        onCancel={() => onSearchingChange(false)}
        onChapter={goToChapter}
        onBookmark={openBookmark}
        onMark={goToMark}
        onLocation={goToLocation}
      />
    );
  return (
    <ScrollArea className="h-full min-h-0">
      {/* No horizontal padding here: the rows carry it themselves, so the
          current chapter's highlight reaches both edges. */}
      <div ref={listRef} tabIndex={-1} className={`flex flex-col py-4 ${SCROLL_BODY}`}>
        <ReaderTocList
          bookId={bookId}
          entries={entries}
          activeIndex={activeIndex}
          revealing={shown}
          onSelect={goToChapter}
        />
      </div>
    </ScrollArea>
  );
}

/**
 * The search in the contents panel. Mounted only while searching, so every
 * search starts from an empty field.
 */
function ContentsSearch({
  bookId,
  shown,
  entries,
  annotations,
  bookmarks,
  onCancel,
  onChapter,
  onBookmark,
  onMark,
  onLocation,
}: {
  bookId: string;
  shown: boolean;
  entries: TocEntry[];
  annotations: Annotation[];
  bookmarks: Bookmark[];
  onCancel: () => void;
  onChapter: (href: string) => void;
  onBookmark: (bookmark: Bookmark) => void;
  onMark: (cfiRange: string) => void;
  onLocation: (location: ReadingLocation) => void;
}) {
  const { t } = useTranslation("reader");
  const [query, setQuery] = useState("");
  // Matching runs on every keystroke; a deferred query keeps typing smooth in
  // a book with tens of thousands of contents entries.
  const deferredQuery = useDeferredValue(query.trim());
  const search = useContentsSearch(bookId, deferredQuery, shown);
  const matches = useMemo<ContentsMatches>(
    () =>
      deferredQuery
        ? {
            chapters: matchChapters(entries, deferredQuery),
            bookmarks: matchBookmarks(bookmarks, deferredQuery),
            marks: matchAnnotations(annotations, deferredQuery),
          }
        : { chapters: [], bookmarks: [], marks: [] },
    [annotations, bookmarks, deferredQuery, entries],
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Words line up with the rows below; the field's own ⊗ clears the
          text and Cancel (or Escape on an empty field) leaves the search. */}
      <div className="flex h-12 shrink-0 items-center gap-1 pr-3 pl-7">
        <SearchField
          variant="plain"
          size="sm"
          autoFocus
          className="min-w-0 flex-1"
          label={t("contentsSearchLabel")}
          placeholder={t("contentsSearch")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Typing in the search must never turn pages or trigger reader keys.
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              if (query) setQuery("");
              else onCancel();
            }
          }}
        />
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("cancelSearch")}
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className={SCROLL_BODY}>
          {deferredQuery && (
            <ReaderContentsResults
              query={deferredQuery}
              entries={entries}
              matches={matches}
              search={search}
              onChapter={onChapter}
              onBookmark={onBookmark}
              onMark={onMark}
              onLocation={onLocation}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
