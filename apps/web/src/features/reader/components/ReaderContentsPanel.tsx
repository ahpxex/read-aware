import { useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BookmarkSimple, MagnifyingGlass } from "@phosphor-icons/react";
import type { Bookmark, ReadingLocation } from "@read-aware/core";
import { Button, ChoiceGroup, IconButton, ScrollArea, SearchField, Tooltip, useToast } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { describeError, useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import type { Annotation } from "../../annotations";
import { useContentsSearch } from "../hooks/useContentsSearch";
import { useReaderBookmarkActions } from "../hooks/useReaderBookmarkActions";
import { useReaderBookmarks } from "../hooks/useReaderBookmarks";
import { useReaderFocusTarget } from "../hooks/useReaderFocusTarget";
import { matchAnnotations, matchBookmarks, matchChapters } from "../lib/contents-search";
import { findTocIndexForHref } from "../lib/epub-utils";
import { goToReadingTarget } from "../lib/reader-bookmarks";
import type { TocEntry } from "../lib/reader-types";
import { ReaderBookmarkList } from "./ReaderBookmarkList";
import { ReaderContentsResults, type ContentsMatches } from "./ReaderContentsResults";
import { ReaderTocList } from "./ReaderTocList";

const log = createLogger("reader-contents");

/**
 * The reader's left panel: a search over everything in the open book —
 * chapters, printed pages, bookmarks, highlights and notes, and the text —
 * above the table of contents and the book's bookmarks.
 */
export function ReaderContentsPanel({
  bookId,
  shown,
  entries,
  activeIndex,
  annotations,
  onChapterSelect,
  onAnnotationSelect,
  onJumped,
}: {
  bookId: string;
  /** The panel is on screen (searches run and the current chapter is revealed only then). */
  shown: boolean;
  entries: TocEntry[];
  activeIndex: number;
  annotations: Annotation[];
  onChapterSelect?: (href: string) => void;
  onAnnotationSelect?: (cfiRange: string) => void;
  /** The reader moved somewhere from the panel (a phone sheet closes). */
  onJumped: () => void;
}) {
  const { t } = useTranslation("reader");
  const { toast } = useToast();
  const [view, setView] = useState<"contents" | "bookmarks">("contents");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  // Matching runs on every keystroke; a deferred query keeps typing smooth in
  // a book with tens of thousands of contents entries.
  const deferredQuery = useDeferredValue(query.trim());
  const listRef = useRef<HTMLDivElement | null>(null);
  useReaderFocusTarget(bookId, "toc", listRef);

  const currentChapter = activeIndex >= 0 ? entries[activeIndex]?.label : undefined;
  const { bookmarks, failed: bookmarksFailed } = useReaderBookmarks(bookId);
  const bookmarkActions = useReaderBookmarkActions(currentChapter);
  const search = useContentsSearch(bookId, deferredQuery, shown && searching);
  const matches = useMemo<ContentsMatches>(
    () =>
      searching && deferredQuery
        ? {
            chapters: matchChapters(entries, deferredQuery),
            bookmarks: matchBookmarks(bookmarks ?? [], deferredQuery),
            marks: matchAnnotations(annotations, deferredQuery),
          }
        : { chapters: [], bookmarks: [], marks: [] },
    [annotations, bookmarks, deferredQuery, entries, searching],
  );

  // The overlay re-renders on every page turn; its callbacks are read through
  // a ref so the (possibly long) result rows are not rebuilt each time.
  const latest = useRef({ onChapterSelect, onAnnotationSelect, onJumped });
  useLayoutEffect(() => {
    latest.current = { onChapterSelect, onAnnotationSelect, onJumped };
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
  const openBookmark = useCallback(
    (bookmark: Bookmark) => {
      void bookmarkActions.open(bookmark).then((moved) => {
        if (moved) latest.current.onJumped();
      });
    },
    [bookmarkActions],
  );
  const bookmarkChapter = useCallback(
    (bookmark: Bookmark) => {
      const href = bookmark.target.href;
      const index = href ? findTocIndexForHref(entries, href) : -1;
      return index >= 0 ? entries[index]?.label : undefined;
    },
    [entries],
  );

  const closeSearch = () => {
    setSearching(false);
    setQuery("");
  };
  const scrollBody = "pb-[calc(1rem+var(--ra-safe-bottom))]";
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* One quiet row: the view switch and its actions, or — while searching —
          the search field in its place. Words align with the rows' text. */}
      <div className="flex h-12 shrink-0 items-center gap-1 pr-3 pl-7">
        {searching ? (
          <>
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
                  else closeSearch();
                }
              }}
            />
            {/* The field's own ⊗ clears the text; this leaves the search. */}
            <Button variant="ghost" size="sm" onClick={closeSearch}>
              {t("cancelSearch")}
            </Button>
          </>
        ) : (
          <>
            <ChoiceGroup
              ariaLabel={t("contents")}
              className="min-w-0 flex-1"
              value={view}
              onChange={setView}
              options={[
                { value: "contents", label: t("contents") },
                { value: "bookmarks", label: t("bookmarksTab") },
              ]}
            />
            {view === "bookmarks" && (
              <Tooltip content={t("addBookmark")} side="bottom">
                <IconButton
                  size="sm"
                  label={t("addBookmark")}
                  icon={<BookmarkSimple size={16} />}
                  onClick={() => void bookmarkActions.add()}
                />
              </Tooltip>
            )}
            <Tooltip content={t("contentsSearchLabel")} side="bottom">
              <IconButton
                size="sm"
                label={t("contentsSearchLabel")}
                icon={<MagnifyingGlass size={16} />}
                onClick={() => setSearching(true)}
              />
            </Tooltip>
          </>
        )}
      </div>
      {/* Keyed by what it shows, so each view starts from its own scroll position. */}
      <ScrollArea key={searching ? "search" : view} className="min-h-0 flex-1">
        {searching && deferredQuery ? (
          <div className={scrollBody}>
            <ReaderContentsResults
              query={deferredQuery}
              entries={entries}
              matches={matches}
              search={search}
              onChapter={goToChapter}
              onBookmark={openBookmark}
              onMark={goToMark}
              onLocation={goToLocation}
            />
          </div>
        ) : view === "contents" ? (
          // No horizontal padding here: the rows carry it themselves, so the
          // current chapter's highlight reaches both edges.
          <div ref={listRef} tabIndex={-1} className={cn("flex flex-col pb-4", scrollBody)}>
            <ReaderTocList
              bookId={bookId}
              entries={entries}
              activeIndex={activeIndex}
              revealing={shown && !searching}
              onSelect={goToChapter}
            />
          </div>
        ) : (
          <div className={scrollBody}>
            <ReaderBookmarkList
              bookmarks={bookmarks}
              failed={bookmarksFailed}
              subtitleOf={bookmarkChapter}
              onOpen={openBookmark}
              onRename={(bookmark, name) => void bookmarkActions.rename(bookmark, name)}
              onRemove={(bookmark) => void bookmarkActions.remove(bookmark)}
            />
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
