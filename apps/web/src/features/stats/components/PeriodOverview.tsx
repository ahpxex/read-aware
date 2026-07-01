import { useMemo } from "react";
import { Caption, Divider, Heading } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { LibraryBook } from "../../library/lib/library-types";
import { formatReadingDuration, type ReadingStatsStore } from "../../reader/lib/reading-stats";
import {
  aggregateByHour,
  aggregateDaily,
  computeAchievements,
  computePeriodInsights,
  periodRangeLabel,
  type StatsPeriod,
} from "../lib/reading-insights";
import type { AnnotationCounts } from "../hooks/useAnnotationCounts";
import { Achievements } from "./Achievements";
import { BookBreakdown } from "./BookBreakdown";
import { DeltaBadge } from "./DeltaBadge";
import { ReadingBars } from "./ReadingBars";
import { ReadingHeatmap } from "./ReadingHeatmap";
import { TimeOfDayChart, WeekdayChart } from "./RhythmCharts";

type PeriodOverviewProps = {
  period: StatsPeriod;
  store: ReadingStatsStore;
  books: LibraryBook[];
  annotations: AnnotationCounts;
  now: number;
  onOpenBook: (book: LibraryBook) => void;
};

function BigStat({ label, value, delta }: { label: string; value: string; delta?: number | null }) {
  return (
    <div className="min-w-0">
      <Caption className="block text-fg-subtle">{label}</Caption>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="truncate font-serif text-[28px] leading-none text-fg tabular-nums">
          {value}
        </span>
        {delta !== undefined && <DeltaBadge value={delta} />}
      </div>
    </div>
  );
}

/** One period tab's full body: headline, charts, rhythm, by-book, and milestones. */
export function PeriodOverview({
  period,
  store,
  books,
  annotations,
  now,
  onOpenBook,
}: PeriodOverviewProps) {
  const { t, i18n } = useTranslation("stats");
  const insights = useMemo(
    () => computePeriodInsights(store, period, now),
    // `computePeriodInsights` reads the active locale for its bar/weekday labels.
    [store, period, now, i18n.language],
  );
  const byHour = useMemo(() => aggregateByHour(store), [store]);
  const daily = useMemo(() => aggregateDaily(store), [store]);
  const achievements = useMemo(
    () => (period === "all" ? computeAchievements(store, now) : null),
    [store, period, now],
  );

  const isWeek = period === "week";
  const monthlyBars = period === "year" || period === "all";
  const showHeatmap = period === "year" || period === "all";

  // On the week view the bars share a row with the hour chart, so match its
  // height (and caption spacing) for the two to line up.
  const barsBlock = (
    <div>
      <Caption className="mb-2 block text-fg-subtle">
        {t(monthlyBars ? "overview.monthlyReading" : "overview.dailyReading")} ·{" "}
        {periodRangeLabel(t, period)}
      </Caption>
      <ReadingBars bars={insights.bars} height={isWeek ? 110 : 160} />
    </div>
  );

  return (
    <div className="ra-motion-page-enter space-y-8">
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
        <BigStat
          label={t("overview.totalTime")}
          value={formatReadingDuration(insights.totalMs)}
          delta={insights.deltaPct}
        />
        <BigStat label={t("overview.booksRead")} value={`${insights.booksRead}`} />
        <BigStat label={t("overview.daysRead")} value={`${insights.daysRead}`} />
        <BigStat label={t("overview.avgPerDay")} value={formatReadingDuration(insights.avgPerDayMs)} />
      </div>

      <Divider />

      {isWeek ? (
        // Sparse 7-day bars pair with the hour histogram on one row; the weekday
        // breakdown is dropped — over 7 days it would just restate the bars.
        <div className="grid gap-8 sm:grid-cols-2">
          {barsBlock}
          <TimeOfDayChart byHour={byHour} />
        </div>
      ) : (
        <>
          {barsBlock}

          {showHeatmap && (
            <>
              <Divider />
              <div>
                <Caption className="mb-2 block text-fg-subtle">{t("readingCalendar")}</Caption>
                <ReadingHeatmap daily={daily} now={now} cell={12} />
              </div>
            </>
          )}

          <Divider />

          <div className="grid gap-8 sm:grid-cols-2">
            <WeekdayChart weekday={insights.weekday} />
            <TimeOfDayChart byHour={byHour} />
          </div>
        </>
      )}

      <Divider />

      <div>
        <Heading size="xl" className="mb-3">
          {t("overview.byBook")}
        </Heading>
        <BookBreakdown
          books={books}
          store={store}
          period={period}
          now={now}
          annotations={annotations}
          onOpenBook={onOpenBook}
        />
      </div>

      {achievements && (
        <>
          <Divider />
          <div>
            <Heading size="xl" className="mb-4">
              {t("overview.milestones")}
            </Heading>
            <Achievements facts={achievements} books={books} />
          </div>
        </>
      )}
    </div>
  );
}
