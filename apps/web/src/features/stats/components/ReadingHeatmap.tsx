import { Caption } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { formatReadingDuration, type DailyReadingMap } from "../../reader/lib/reading-stats";
import {
  buildHeatmapYears,
  type HeatmapCell,
  type HeatmapLevel,
  type HeatmapYear,
} from "../lib/reading-insights";

type ReadingHeatmapProps = {
  daily: DailyReadingMap;
  /** Reference "now" (epoch ms); defaults to the current time. */
  now?: number;
  /** Square size in px (default 10). */
  cell?: number;
  /** Max height of the (vertically scrolling) year stack. */
  maxHeightClass?: string;
  className?: string;
};

const GAP = 2;
const AXIS_W = 22;
const AXIS_GAP = 4;
const MONTH_ROW_H = 14;

/** Single-color ink ramp — theme-aware (inverts in dark mode via the `fg` token). */
const LEVEL_CLASS: Record<HeatmapLevel, string> = {
  0: "bg-fg/[0.06]",
  1: "bg-fg/25",
  2: "bg-fg/45",
  3: "bg-fg/70",
  4: "bg-fg",
};

const WEEKDAY_AXIS = ["", "Mon", "", "Wed", "", "Fri", ""];

function cellTitle(cell: HeatmapCell): string | undefined {
  if (!cell.active) return undefined;
  const date = cell.date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return `${date} · ${formatReadingDuration(cell.ms)}`;
}

function YearGrid({ year, cell }: { year: HeatmapYear; cell: number }) {
  const colW = cell + GAP;
  const width = year.columns.length * colW;
  return (
    <div>
      <Caption className="mb-1 block font-medium text-fg-muted tabular-nums">{year.year}</Caption>
      <div className="overflow-x-auto pb-1">
        <div className="inline-block">
          <div className="flex" style={{ gap: AXIS_GAP }}>
            <div style={{ width: AXIS_W }} />
            <div className="relative" style={{ width, height: MONTH_ROW_H }}>
              {year.monthLabels.map((label) => (
                <span
                  key={`${label.col}-${label.label}`}
                  className="absolute top-0 whitespace-nowrap text-[10px] leading-none text-fg-subtle"
                  style={{ left: label.col * colW }}
                >
                  {label.label}
                </span>
              ))}
            </div>
          </div>
          <div className="flex" style={{ gap: AXIS_GAP }}>
            <div className="flex flex-col" style={{ gap: GAP, width: AXIS_W }}>
              {WEEKDAY_AXIS.map((label, row) => (
                <span
                  key={row}
                  className="flex items-center text-[9px] leading-none text-fg-subtle"
                  style={{ height: cell }}
                >
                  {label}
                </span>
              ))}
            </div>
            <div className="flex" style={{ gap: GAP }}>
              {year.columns.map((column, col) => (
                <div key={col} className="flex flex-col" style={{ gap: GAP }}>
                  {column.map((day) => (
                    <div
                      key={day.key}
                      title={cellTitle(day)}
                      className={cn(
                        "rounded-[2px]",
                        day.active ? LEVEL_CLASS[day.level] : "invisible",
                        day.isToday && "outline outline-1 outline-offset-[-1px] outline-fg",
                      )}
                      style={{ width: cell, height: cell }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Calendar heatmap of reading time, one GitHub-style grid per year (newest
 * first), spanning the full recorded history. Years stack vertically and each
 * scrolls horizontally, so any span — months or many years — renders without
 * clipping. Purely presentational: pass any `daily` map (one book's or the
 * library-wide aggregate).
 */
export function ReadingHeatmap({
  daily,
  now,
  cell = 10,
  maxHeightClass = "max-h-72",
  className,
}: ReadingHeatmapProps) {
  const years = buildHeatmapYears(daily, now ?? Date.now());

  return (
    <div className={className}>
      <div className={cn("flex flex-col gap-4 overflow-y-auto pr-1", maxHeightClass)}>
        {years.map((year) => (
          <YearGrid key={year.year} year={year} cell={cell} />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5">
        <Caption className="text-fg-subtle">Less</Caption>
        {([0, 1, 2, 3, 4] as HeatmapLevel[]).map((level) => (
          <div
            key={level}
            className={cn("rounded-[2px]", LEVEL_CLASS[level])}
            style={{ width: cell, height: cell }}
          />
        ))}
        <Caption className="text-fg-subtle">More</Caption>
      </div>
    </div>
  );
}
