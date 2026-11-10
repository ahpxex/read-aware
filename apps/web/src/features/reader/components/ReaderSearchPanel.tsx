import { useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Bookmark, ReadingLocation } from "@read-aware/core";
import { Button, ScrollArea, SearchField, useToast, type VirtualRowsHandle } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { describeError, useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import type { Annotation } from "../../annotations";
import { useContentsSearch } from "../hooks/useContentsSearch";
import { useRememberedSearchQuery } from "../hooks/useRememberedSearchQuery";
import { useSearchListPlace } from "../hooks/useSearchListPlace";
import { matchAnnotations, matchBookmarks, matchChapters } from "../lib/contents-search";
import { goToReadingTarget } from "../lib/reader-bookmarks";
import type { TocEntry } from "../lib/reader-types";
import { ReaderContentsResults, type ContentsMatches } from "./ReaderContentsResults";

const log = createLogger("reader-search");
const SCROLL_BODY = "pb-2";

/**
 * Search everything in the open book — chapters, printed pages, bookmarks,
 * highlights and notes, and the text. Shown in a popup from the header (a
 * sheet on a phone) and mounted only while open. It reopens on the last
 * query searched in the book, with that query's results at the place the
 * list was left (see lib/book-search-memory). The host bounds its height;
 * results scroll inside.
 */
export function ReaderSearchPanel({
  bookId,
  shown,
  entries,
  annotations,
  bookmarks,
  onClose,
  showCancel = false,
  focusRestored = true,
  className,
  onChapterSelect,
  onAnnotationSelect,
  onBookmarkSelect,
  onJumped,
}: {
  bookId: string;
  /** The panel is on screen: the text search runs only then. */
  shown: boolean;
  entries: TocEntry[];
  annotations: Annotation[];
  bookmarks: Bookmark[];
  /** Escape on an empty field (or Cancel) closes the search. */
  onClose: () => void;
  /** A Cancel button beside the field, for hosts without another way to close. */
  showCancel?: boolean;
  /**
   * Focus the field (its text selected, ready to be replaced) when it opens
   * on a remembered query. A phone host passes false so the keyboard does
   * not cover the remembered results; an empty field is always focused.
   */
  focusRestored?: boolean;
  className?: string;
  onChapterSelect?: (href: string) => void;
  onAnnotationSelect?: (cfiRange: string) => void;
  /** Resolves true once the reader has moved. */
  onBookmarkSelect: (bookmark: Bookmark) => Promise<boolean>;
  /** The reader moved somewhere from the panel (a phone sheet closes). */
  onJumped: () => void;
}) {
  const { t } = useTranslation("reader");
  const { toast } = useToast();
  const [query, setQuery] = useRememberedSearchQuery(bookId);
  // Decided as it opens: a remembered query is selected, or left unfocused.
  const [opening] = useState(() => ({ restored: query.trim() !== "", focus: query.trim() === "" || focusRestored }));
  const fieldRef = useRef<HTMLInputElement | null>(null);
  useLayoutEffect(() => {
    if (opening.restored && opening.focus) fieldRef.current?.select();
  }, [opening]);
  // Matching runs on every keystroke; a deferred query keeps typing smooth in
  // a book with tens of thousands of contents entries.
  const deferredQuery = useDeferredValue(query.trim());
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
  // The chapters listed as results: their titles are not listed again as text.
  const chapterTitles = useMemo(() => matches.chapters.map((index) => entries[index]!.label), [matches, entries]);
  const search = useContentsSearch(bookId, deferredQuery, shown, chapterTitles);
  const rowsRef = useRef<VirtualRowsHandle | null>(null);
  const rememberPlace = useSearchListPlace(bookId, deferredQuery, rowsRef);

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

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {/* The field's own ⊗ clears the text; Escape on an empty field (or
          Cancel) closes the search. Its icon lines up with the results' text. */}
      <div
        className={cn(
          "flex h-12 shrink-0 items-center gap-1 pl-4",
          showCancel ? "pr-2" : "pr-4",
          deferredQuery && "border-b border-border/60",
        )}
      >
        <SearchField
          ref={fieldRef}
          variant="plain"
          size="sm"
          autoFocus={opening.focus}
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
              else onClose();
            }
          }}
        />
        {showCancel && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("cancelSearch")}
          </Button>
        )}
      </div>
      {deferredQuery && (
        <ScrollArea className="min-h-0 flex-1" onScroll={rememberPlace}>
          <div className={SCROLL_BODY}>
            <ReaderContentsResults
              query={deferredQuery}
              entries={entries}
              matches={matches}
              search={search}
              onChapter={goToChapter}
              onBookmark={openBookmark}
              onMark={goToMark}
              onLocation={goToLocation}
              rowsRef={rowsRef}
            />
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
