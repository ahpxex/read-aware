import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { BookOpen, ChartLineUp } from "@phosphor-icons/react";
import { Body, Caption, Divider, EmptyState, Eyebrow, Heading } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { readingStatsAtom } from "../../../state/ui";
import type { LibraryBook } from "../../library/lib/library-types";
import { formatReadingDuration } from "../../reader/lib/reading-stats";
import { aggregateDaily, computeBookInsights, computeGlobalInsights } from "../lib/reading-insights";
import { useAnnotationCounts } from "../hooks/useAnnotationCounts";
import { ReadingHeatmap } from "./ReadingHeatmap";

type StatsWorkspaceProps = {
  books: LibraryBook[];
  onOpenBook: (book: LibraryBook) => void;
};

function BigStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <Caption className="block text-fg-subtle">{label}</Caption>
      <div className="mt-1 truncate font-serif text-[28px] leading-none text-fg tabular-nums">
        {value}
      </div>
      {hint && <Caption className="mt-1 block truncate text-fg-subtle">{hint}</Caption>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right tabular-nums">
      <div className="text-sm font-medium text-fg">{value}</div>
      <Caption className="block text-fg-subtle">{label}</Caption>
    </div>
  );
}

export function StatsWorkspace({ books, onOpenBook }: StatsWorkspaceProps) {
  const store = useAtomValue(readingStatsAtom);
  const annotations = useAnnotationCounts();
  const now = Date.now();

  const insights = useMemo(() => computeGlobalInsights(store, now), [store, now]);
  const daily = useMemo(() => aggregateDaily(store), [store]);
  const bookMap = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);

  /** Books with recorded reading, richest first, joined to their library entry. */
  const ranked = useMemo(() => {
    return Object.values(store)
      .filter((stats) => stats.totalMs > 0 && bookMap.has(stats.bookId))
      .sort((a, b) => b.totalMs - a.totalMs)
      .map((stats) => ({
        book: bookMap.get(stats.bookId)!,
        insights: computeBookInsights(stats, now),
      }));
  }, [store, bookMap, now]);

  const continueBook =
    insights.mostRecentBookId !== null ? bookMap.get(insights.mostRecentBookId) ?? null : null;

  if (insights.totalMs === 0) {
    return (
      <div className="ra-motion-page-enter mx-auto flex min-h-full max-w-screen-2xl flex-col justify-center px-6 py-16">
        <EmptyState
          icon={<ChartLineUp size={32} weight="regular" />}
          title="No reading yet"
          description="Open a book — your reading time, streaks, and a calendar of your habit will build up here."
        />
      </div>
    );
  }

  return (
    <div className="ra-motion-page-enter mx-auto max-w-5xl px-6 py-8 sm:py-10">
      <div className="mb-8">
        <Heading size="2xl">Reading stats</Heading>
        <Body className="mt-1 text-sm text-fg-muted">
          {formatReadingDuration(insights.totalMs)} across {insights.booksWithReading} book
          {insights.booksWithReading !== 1 ? "s" : ""}
          {insights.currentStreak > 0 ? ` · ${insights.currentStreak}-day streak` : ""}
        </Body>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4">
        <BigStat label="Total time" value={formatReadingDuration(insights.totalMs)} />
        <BigStat
          label="Day streak"
          value={`${insights.currentStreak}d`}
          hint={insights.longestStreak > 0 ? `best ${insights.longestStreak}d` : undefined}
        />
        <BigStat label="This week" value={formatReadingDuration(insights.weekMs)} />
        <BigStat label="Today" value={formatReadingDuration(insights.todayMs)} />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Metric label="Books reading" value={`${insights.booksWithReading}`} />
        <Metric label="Days read" value={`${insights.daysRead}`} />
        <Metric label="Notes" value={`${annotations.notes}`} />
        <Metric label="Highlights" value={`${annotations.highlights}`} />
      </div>

      {continueBook && (
        <>
          <Divider className="my-8" />
          <button
            type="button"
            onClick={() => onOpenBook(continueBook)}
            className="flex w-full items-center gap-4 rounded-md p-2 text-left transition-colors hover:bg-fill focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
          >
            {continueBook.coverUrl ? (
              <img
                src={continueBook.coverUrl}
                alt=""
                className="h-20 w-14 shrink-0 rounded-sm border border-border object-cover"
              />
            ) : (
              <div className="flex h-20 w-14 shrink-0 items-center justify-center rounded-sm border border-border bg-fill text-fg-subtle">
                <BookOpen size={20} aria-hidden="true" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <Eyebrow className="text-fg-subtle">Continue reading</Eyebrow>
              <Heading size="xl" className="mt-0.5 line-clamp-2 leading-snug">
                {continueBook.title}
              </Heading>
              <Caption className="mt-1 block tabular-nums text-fg-subtle">
                {Math.round(continueBook.progressPercent)}% read
              </Caption>
            </div>
          </button>
        </>
      )}

      <Divider className="my-8" />

      <div className="mb-4">
        <Heading size="xl">Reading calendar</Heading>
      </div>
      <ReadingHeatmap daily={daily} now={now} cell={13} maxHeightClass="max-h-[30rem]" />

      <Divider className="my-8" />

      <div className="mb-4">
        <Heading size="xl">By book</Heading>
      </div>
      <div className="flex flex-col">
        {ranked.map(({ book, insights: bookInsights }, index) => {
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
                <Metric label="Time" value={formatReadingDuration(bookInsights.totalMs)} />
                <Metric label="Progress" value={`${Math.round(book.progressPercent)}%`} />
                <Metric label="Days" value={`${bookInsights.daysRead}`} />
                <Metric label="Notes" value={`${counts?.notes ?? 0}`} />
              </div>
              <div className="shrink-0 sm:hidden">
                <Metric label="Time" value={formatReadingDuration(bookInsights.totalMs)} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
