import { useEffect, useMemo, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { ChartLineUp } from "@phosphor-icons/react";
import { Body, EmptyState, Heading, Tabs } from "@read-aware/ui";
import { readingStatsAtom } from "../../../state/ui";
import type { LibraryBook } from "../../library/lib/library-types";
import { formatReadingDuration } from "../../reader/lib/reading-stats";
import { computeGlobalInsights, PERIOD_TAB_LABELS, STATS_PERIODS } from "../lib/reading-insights";
import { seedReadingStats } from "../lib/stats-mock";
import { useAnnotationCounts } from "../hooks/useAnnotationCounts";
import { PeriodOverview } from "./PeriodOverview";

type StatsWorkspaceProps = {
  books: LibraryBook[];
  onOpenBook: (book: LibraryBook) => void;
};

export function StatsWorkspace({ books, onOpenBook }: StatsWorkspaceProps) {
  const store = useAtomValue(readingStatsAtom);
  const setStore = useSetAtom(readingStatsAtom);
  const annotations = useAnnotationCounts();
  const now = Date.now();

  const insights = useMemo(() => computeGlobalInsights(store, now), [store, now]);

  // Dev only: when there isn't enough real reading to make the page interesting,
  // overwrite localStorage with a believable history so the charts have something
  // to show. Fires once per mount and not once genuine reading accrues.
  const seededRef = useRef(false);
  const willAutoSeed =
    import.meta.env.DEV && books.length > 0 && insights.totalMs < 60 * 60_000;
  useEffect(() => {
    if (!willAutoSeed || seededRef.current) return;
    seededRef.current = true;
    setStore(seedReadingStats(books, Date.now()));
  }, [willAutoSeed, books, setStore]);

  const tabs = useMemo(
    () =>
      STATS_PERIODS.map((period) => ({
        label: PERIOD_TAB_LABELS[period],
        content: (
          <div className="pt-8">
            <PeriodOverview
              period={period}
              store={store}
              books={books}
              annotations={annotations}
              now={now}
              onOpenBook={onOpenBook}
            />
          </div>
        ),
      })),
    [store, books, annotations, now, onOpenBook],
  );

  // Seeding momentarily — render nothing rather than flash sparse/empty content.
  if (willAutoSeed) return null;

  if (insights.totalMs === 0) {
    return (
      <div className="ra-motion-page-enter mx-auto flex min-h-full max-w-5xl flex-col items-center justify-center px-6 py-16">
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
      <div className="mb-6">
        <Heading size="2xl">Reading stats</Heading>
        <Body className="mt-1 text-sm text-fg-muted">
          {formatReadingDuration(insights.totalMs)} across {insights.booksWithReading} book
          {insights.booksWithReading !== 1 ? "s" : ""}
          {insights.currentStreak > 0 ? ` · ${insights.currentStreak}-day streak` : ""}
        </Body>
      </div>

      <Tabs items={tabs} variant="underline" ariaLabel="Reading period" />
    </div>
  );
}
