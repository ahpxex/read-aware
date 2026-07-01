import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { Caption, Divider } from "@read-aware/ui";
import { formatDate, formatPercent, useTranslation } from "../../../i18n";
import { readingStatsAtom } from "../../../state/ui";
import type { LibraryBook } from "../../library/lib/library-types";
import { useBookAnnotations } from "../../annotations/hooks/useBookAnnotations";
import { formatReadingDuration, getBookReadingStats } from "../../reader/lib/reading-stats";
import { computeBookInsights } from "../lib/reading-insights";
import { StatTile } from "./StatTile";
import { WeeklyBars } from "./WeeklyBars";
import { ReadingHeatmap } from "./ReadingHeatmap";

type BookStatsPanelProps = {
  book: LibraryBook;
};

function formatDay(epoch: number | null): string {
  if (epoch === null) return "—";
  return formatDate(epoch, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Compact reading statistics for one book — the body of the shelf Info dialog.
 * Headline figures, the weekly bars, and a full-history calendar heatmap. The
 * exhaustive breakdown lives on the Stats page; this stays scannable.
 */
export function BookStatsPanel({ book }: BookStatsPanelProps) {
  const { t } = useTranslation("stats");
  const store = useAtomValue(readingStatsAtom);
  const { annotations } = useBookAnnotations(book.id);

  const now = Date.now();
  const stats = getBookReadingStats(store, book.id);
  const insights = useMemo(() => computeBookInsights(stats, now), [stats, now]);

  const noteCount = annotations.filter((a) => a.type === "note").length;
  const highlightCount = annotations.filter((a) => a.type === "highlight").length;
  const started =
    insights.firstStartedAt === null ? t("book.notStarted") : formatDay(insights.firstStartedAt);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-x-4 gap-y-2.5">
        <StatTile label={t("book.totalTime")} value={formatReadingDuration(insights.totalMs)} />
        <StatTile label={t("book.thisWeek")} value={formatReadingDuration(insights.weekMs)} />
        <StatTile
          label={t("book.dayStreak")}
          value={t("days.compact", { count: insights.currentStreak })}
          hint={
            insights.longestStreak > 0
              ? t("book.best", { count: insights.longestStreak })
              : undefined
          }
        />
        <StatTile label={t("book.daysRead")} value={`${insights.daysRead}`} />
        <StatTile label={t("book.notes")} value={`${noteCount}`} />
        <StatTile label={t("book.highlights")} value={`${highlightCount}`} />
      </div>

      <Caption className="block text-fg-subtle">
        {t("book.summary", {
          percent: formatPercent(book.progressPercent),
          start: started,
          last: formatDay(insights.lastReadAt),
        })}
      </Caption>

      <Divider />

      <WeeklyBars daily={stats.daily} now={now} height={40} />

      <Divider />

      <div>
        <Caption className="mb-2 block text-fg-subtle">{t("readingCalendar")}</Caption>
        <ReadingHeatmap daily={stats.daily} now={now} cell={9} />
      </div>
    </div>
  );
}
