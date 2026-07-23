import { useEffect, useMemo, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { ChartLineUp } from "@phosphor-icons/react";
import { Body, EmptyState, Heading, Tabs } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { readingStatsAtom } from "../../../state/ui";
import type { LibraryBook } from "../../library/lib/library-types";
import {
  formatReadingDuration,
  replaceReadingStatsStore,
} from "../../reader/lib/reading-stats";
import { computeGlobalInsights, periodTabLabel, STATS_PERIODS } from "../lib/reading-insights";
import { seedReadingStats } from "../lib/stats-mock";
import { useAnnotationCounts } from "../hooks/useAnnotationCounts";
import { PeriodOverview } from "./PeriodOverview";

type StatsWorkspaceProps = {
  books: LibraryBook[];
  onOpenBook: (book: LibraryBook) => void;
};

export function StatsWorkspace({ books, onOpenBook }: StatsWorkspaceProps) {
  const { t, i18n } = useTranslation("stats");
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
    const seeded = seedReadingStats(books, Date.now());
    setStore(seeded);
    replaceReadingStatsStore(seeded);
  }, [willAutoSeed, books, setStore]);

  const tabs = useMemo(
    () =>
      STATS_PERIODS.map((period) => ({
        label: periodTabLabel(t, period),
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
    [store, books, annotations, now, onOpenBook, t, i18n.language],
  );

  // Seeding momentarily — render nothing rather than flash sparse/empty content.
  if (willAutoSeed) return null;

  if (insights.totalMs === 0) {
    return (
      <div className="ra-motion-page-enter mx-auto flex min-h-full max-w-5xl flex-col items-center justify-center px-6 py-16">
        <EmptyState
          icon={<ChartLineUp size={32} weight="regular" />}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      </div>
    );
  }

  return (
    <div className="ra-motion-page-enter mx-auto max-w-5xl px-6 py-8 sm:py-10">
      <div className="mb-6">
        <Heading size="2xl">{t("title")}</Heading>
        <Body className="mt-1 text-sm text-fg-muted">
          {t("summary.books", {
            duration: formatReadingDuration(insights.totalMs),
            count: insights.booksWithReading,
          })}
          {insights.currentStreak > 0
            ? ` · ${t("summary.streak", { count: insights.currentStreak })}`
            : ""}
        </Body>
      </div>

      <Tabs items={tabs} variant="underline" ariaLabel={t("periodTablist")} />
    </div>
  );
}
