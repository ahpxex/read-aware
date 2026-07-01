import { formatDate, useTranslation } from "../../../i18n";
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
  return formatDate(new Date(y, m - 1, d), { month: "short", day: "numeric" });
}

/** All-time milestones — total time (with the next target), streaks, best day, etc. */
export function Achievements({ facts, books }: AchievementsProps) {
  const { t } = useTranslation("stats");
  const nextMs = nextTimeMilestone(facts.totalMs);
  const mostRead = facts.mostReadBookId
    ? books.find((b) => b.id === facts.mostReadBookId)
    : undefined;

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
      <StatTile
        label={t("achievements.totalReading")}
        value={formatReadingDuration(facts.totalMs)}
        hint={
          nextMs
            ? t("achievements.next", { duration: formatReadingDuration(nextMs) })
            : t("achievements.allPassed")
        }
      />
      <StatTile
        label={t("achievements.longestStreak")}
        value={t("days.compact", { count: facts.longestStreak })}
        hint={
          facts.currentStreak > 0
            ? t("achievements.current", { count: facts.currentStreak })
            : undefined
        }
      />
      <StatTile
        label={t("achievements.bestDay")}
        value={formatReadingDuration(facts.bestDayMs)}
        hint={formatDay(facts.bestDayKey)}
      />
      <StatTile label={t("achievements.daysRead")} value={`${facts.daysRead}`} />
      <StatTile label={t("achievements.booksRead")} value={`${facts.booksRead}`} />
      <StatTile
        label={t("achievements.mostRead")}
        value={mostRead?.title ?? "—"}
        hint={facts.mostReadBookMs > 0 ? formatReadingDuration(facts.mostReadBookMs) : undefined}
      />
    </div>
  );
}
