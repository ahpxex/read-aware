import { useMemo } from "react";
import { BookOpen } from "@phosphor-icons/react";
import { Body, Caption } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import type { LibraryBook } from "../../library/lib/library-types";
import { formatReadingDuration, type ReadingStatsStore } from "../../reader/lib/reading-stats";
import { bookWindowStats, type StatsPeriod } from "../lib/reading-insights";
import type { AnnotationCounts } from "../hooks/useAnnotationCounts";

type BookBreakdownProps = {
  books: LibraryBook[];
  store: ReadingStatsStore;
  period: StatsPeriod;
  now: number;
  annotations: AnnotationCounts;
  onOpenBook: (book: LibraryBook) => void;
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right tabular-nums">
      <div className="text-sm font-medium text-fg">{value}</div>
      <Caption className="block text-fg-subtle">{label}</Caption>
    </div>
  );
}

/**
 * Books read within the active period, richest first, each row linking back into
 * the reader. Time and active days are scoped to the period; progress stays
 * cumulative (it's a property of the book, not the window).
 */
export function BookBreakdown({
  books,
  store,
  period,
  now,
  annotations,
  onOpenBook,
}: BookBreakdownProps) {
  const bookMap = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);

  const ranked = useMemo(() => {
    return Object.values(store)
      .filter((stats) => bookMap.has(stats.bookId))
      .map((stats) => ({ book: bookMap.get(stats.bookId)!, window: bookWindowStats(stats, period, now) }))
      .filter((row) => row.window.ms > 0)
      .sort((a, b) => b.window.ms - a.window.ms);
  }, [store, bookMap, period, now]);

  if (ranked.length === 0) {
    return <Caption className="block text-fg-subtle">No books read in this period.</Caption>;
  }

  return (
    <div className="flex flex-col">
      {ranked.map(({ book, window }, index) => {
        const counts = annotations.byBook.get(book.id);
        return (
          <button
            key={book.id}
            type="button"
            onClick={() => onOpenBook(book)}
            className={cn(
              "flex items-center gap-3 py-3 text-left transition-colors hover:bg-fill focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
              index > 0 && "border-t border-border",
            )}
          >
            {book.coverUrl ? (
              <img
                src={book.coverUrl}
                alt=""
                className="h-12 w-9 shrink-0 rounded-sm border border-border object-cover"
              />
            ) : (
              <div className="flex h-12 w-9 shrink-0 items-center justify-center rounded-sm border border-border bg-fill text-fg-subtle">
                <BookOpen size={14} aria-hidden="true" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <Body className="truncate text-sm font-medium text-fg">{book.title}</Body>
              {book.author && (
                <Caption className="block truncate text-fg-subtle">{book.author}</Caption>
              )}
            </div>
            <div className="hidden shrink-0 items-center gap-6 sm:flex">
              <Metric label="Time" value={formatReadingDuration(window.ms)} />
              <Metric label="Progress" value={`${Math.round(book.progressPercent)}%`} />
              <Metric label="Days" value={`${window.daysRead}`} />
              <Metric label="Notes" value={`${counts?.notes ?? 0}`} />
            </div>
            <div className="shrink-0 sm:hidden">
              <Metric label="Time" value={formatReadingDuration(window.ms)} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
