import { Caption } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import {
  emptyBookStats,
  formatReadingDuration,
  weeklyReadingBuckets,
  type DailyReadingMap,
} from "../../reader/lib/reading-stats";

type WeeklyBarsProps = {
  daily: DailyReadingMap;
  now: number;
  /** Max bar height in px (default 56). */
  height?: number;
  className?: string;
};

/** Single-letter weekday labels, indexed by `Date.getDay()` (Sun..Sat). */
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

/** Last seven days of reading time as a quiet bar chart; today's bar reads darker. */
export function WeeklyBars({ daily, now, height = 56, className }: WeeklyBarsProps) {
  const week = weeklyReadingBuckets({ ...emptyBookStats(""), daily }, now);
  const maxMs = Math.max(1, ...week.map((day) => day.ms));

  return (
    <div className={className}>
      <Caption className="mb-2 block text-fg-subtle">Last 7 days</Caption>
      <div className="flex items-end gap-1.5" style={{ height: height + 16 }}>
        {week.map((day) => {
          const barHeight =
            day.ms > 0 ? Math.max(4, Math.round((day.ms / maxMs) * height)) : 2;
          return (
            <div
              key={day.key}
              className="flex flex-1 flex-col items-center justify-end gap-1"
              title={`${day.key} · ${formatReadingDuration(day.ms)}`}
            >
              <div
                className={cn(
                  "w-full rounded-sm",
                  day.ms > 0 ? (day.isToday ? "bg-fg" : "bg-fg-subtle") : "bg-border",
                )}
                style={{ height: barHeight }}
              />
              <span
                className={cn(
                  "text-[10px] leading-none tabular-nums",
                  day.isToday ? "font-semibold text-fg" : "text-fg-subtle",
                )}
              >
                {WEEKDAY_LABELS[day.date.getDay()]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
