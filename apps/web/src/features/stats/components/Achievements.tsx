import { formatReadingDuration } from "../../reader/lib/reading-stats";
import type { LibraryBook } from "../../library/lib/library-types";
import { nextTimeMilestone, type AchievementFacts } from "../lib/reading-insights";
import { StatTile } from "./StatTile";

type AchievementsProps = {
  facts: AchievementFacts;
  books: LibraryBook[];
};

function formatDay(key: string | null): string | undefined {
  if (!key) return undefined;
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** All-time milestones — total time (with the next target), streaks, best day, etc. */
export function Achievements({ facts, books }: AchievementsProps) {
  const nextMs = nextTimeMilestone(facts.totalMs);
  const mostRead = facts.mostReadBookId
    ? books.find((b) => b.id === facts.mostReadBookId)
    : undefined;

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
      <StatTile
        label="Total reading"
        value={formatReadingDuration(facts.totalMs)}
        hint={nextMs ? `next ${formatReadingDuration(nextMs)}` : "all milestones passed"}
      />
      <StatTile
        label="Longest streak"
        value={`${facts.longestStreak}d`}
        hint={facts.currentStreak > 0 ? `current ${facts.currentStreak}d` : undefined}
      />
      <StatTile
        label="Best day"
        value={formatReadingDuration(facts.bestDayMs)}
        hint={formatDay(facts.bestDayKey)}
      />
      <StatTile label="Days read" value={`${facts.daysRead}`} />
      <StatTile label="Books read" value={`${facts.booksRead}`} />
      <StatTile
        label="Most read"
        value={mostRead?.title ?? "—"}
        hint={facts.mostReadBookMs > 0 ? formatReadingDuration(facts.mostReadBookMs) : undefined}
      />
    </div>
  );
}
