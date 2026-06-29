import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { Caption, Divider } from "@read-aware/ui";
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
  return new Date(epoch).toLocaleDateString(undefined, {
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
  const store = useAtomValue(readingStatsAtom);
  const { annotations } = useBookAnnotations(book.id);

  const now = Date.now();
  const stats = getBookReadingStats(store, book.id);
  const insights = useMemo(() => computeBookInsights(stats, now), [stats, now]);

  const noteCount = annotations.filter((a) => a.type === "note").length;
  const highlightCount = annotations.filter((a) => a.type === "highlight").length;
  const started = insights.firstStartedAt === null ? "Not started" : formatDay(insights.firstStartedAt);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-x-4 gap-y-2.5">
        <StatTile label="Total time" value={formatReadingDuration(insights.totalMs)} />
        <StatTile label="This week" value={formatReadingDuration(insights.weekMs)} />
        <StatTile
          label="Day streak"
          value={`${insights.currentStreak}d`}
          hint={insights.longestStreak > 0 ? `best ${insights.longestStreak}d` : undefined}
        />
        <StatTile label="Days read" value={`${insights.daysRead}`} />
        <StatTile label="Notes" value={`${noteCount}`} />
        <StatTile label="Highlights" value={`${highlightCount}`} />
      </div>

      <Caption className="block text-fg-subtle">
        {Math.round(book.progressPercent)}% read · Started {started} · Last read{" "}
        {formatDay(insights.lastReadAt)}
      </Caption>

      <Divider />

      <WeeklyBars daily={stats.daily} now={now} height={40} />

      <Divider />

      <div>
        <Caption className="mb-2 block text-fg-subtle">Reading calendar</Caption>
        <ReadingHeatmap daily={stats.daily} now={now} cell={9} />
      </div>
    </div>
  );
}
