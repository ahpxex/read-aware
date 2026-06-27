import { BookOpen, ChartBar } from "@phosphor-icons/react";
import { useAtomValue } from "jotai";
import { Body, Caption, Divider, Popover } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { readingStatsAtom } from "../../../state/ui";
import type { LibraryBook } from "../../library/lib/library-types";
import {
  formatReadingDuration,
  getBookReadingStats,
  weeklyReadingBuckets,
} from "../lib/reading-stats";

type ReaderStatsMenuProps = {
  book: LibraryBook;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** Single-letter weekday labels, indexed by `Date.getDay()` (Sun..Sat). */
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const CHART_HEIGHT = 56;

/**
 * Reading-stats popover for the open book: identity (cover/title/author), key
 * figures (total time, this week, started, progress), and a bar chart of the
 * last seven days' reading time. Read-only — figures come from the reading-stats
 * seam, kept current by `useReadingTimeTracker`.
 */
export function ReaderStatsMenu({ book, open, onOpenChange }: ReaderStatsMenuProps) {
  const store = useAtomValue(readingStatsAtom);
  const stats = getBookReadingStats(store, book.id);
  const now = Date.now();
  const week = weeklyReadingBuckets(stats, now);
  const weekMs = week.reduce((sum, day) => sum + day.ms, 0);
  const maxMs = Math.max(1, ...week.map((day) => day.ms));

  const started = stats.firstStartedAt
    ? new Date(stats.firstStartedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Not started";

  return (
    <Popover
      align="right"
      triggerLabel="Reading stats"
      triggerTooltip="Reading stats"
      className="pointer-events-auto"
      triggerClassName="h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
      trigger={<ChartBar size={18} weight="regular" aria-hidden="true" />}
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="flex w-72 flex-col gap-4">
        <div className="flex items-start gap-3">
          {book.coverUrl ? (
            <img
              src={book.coverUrl}
              alt=""
              className="h-16 w-11 shrink-0 rounded-sm border border-border object-cover"
            />
          ) : (
            <div className="flex h-16 w-11 shrink-0 items-center justify-center rounded-sm border border-border bg-fill text-fg-subtle">
              <BookOpen size={18} aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <Body className="line-clamp-2 text-sm font-semibold leading-snug text-fg">
              {book.title}
            </Body>
            {book.author && (
              <Caption className="mt-0.5 block truncate text-fg-subtle">
                {book.author}
              </Caption>
            )}
          </div>
        </div>

        <Divider />

        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Stat label="Total time" value={formatReadingDuration(stats.totalMs)} />
          <Stat label="This week" value={formatReadingDuration(weekMs)} />
          <Stat label="Started" value={started} />
          <Stat label="Progress" value={`${Math.round(book.progressPercent)}%`} />
        </div>

        <Divider />

        <div>
          <Caption className="mb-2 block text-fg-subtle">Last 7 days</Caption>
          <div className="flex items-end gap-1.5" style={{ height: CHART_HEIGHT + 16 }}>
            {week.map((day) => {
              const barHeight =
                day.ms > 0
                  ? Math.max(4, Math.round((day.ms / maxMs) * CHART_HEIGHT))
                  : 2;
              return (
                <div
                  key={day.key}
                  className="flex flex-1 flex-col items-center justify-end gap-1"
                  title={`${day.key} · ${formatReadingDuration(day.ms)}`}
                >
                  <div
                    className={cn(
                      "w-full rounded-sm",
                      day.ms > 0
                        ? day.isToday
                          ? "bg-fg"
                          : "bg-fg-subtle"
                        : "bg-border",
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
      </div>
    </Popover>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <Caption className="block text-fg-subtle">{label}</Caption>
      <Body className="truncate text-sm font-medium tabular-nums text-fg">
        {value}
      </Body>
    </div>
  );
}
