import { Caption } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { formatDate, getWeekdayNames, useTranslation } from "../../../i18n";
import { formatReadingDuration, type DailyReadingMap } from "../../reader/lib/reading-stats";
import { buildHeatmapGrid, type HeatmapCell, type HeatmapLevel } from "../lib/reading-insights";

type ReadingHeatmapProps = {
  daily: DailyReadingMap;
  /** Reference "now" (epoch ms); defaults to the current time. */
  now?: number;
  /** Square size in px (default 10). */
  cell?: number;
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

function cellTitle(cell: HeatmapCell): string | undefined {
  if (!cell.active) return undefined;
  const date = formatDate(cell.date, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return `${date} · ${formatReadingDuration(cell.ms)}`;
}

/**
 * Calendar heatmap of reading time — one continuous GitHub-style grid ending on
 * the current week, so today sits at the right edge. It spans at least the
 * trailing year (and further back if there's older history), scrolling
 * horizontally when the span exceeds the available width. Purely presentational:
 * pass any `daily` map (one book's or the library-wide aggregate).
 */
export function ReadingHeatmap({ daily, now, cell = 10, className }: ReadingHeatmapProps) {
  const { t } = useTranslation("stats");
  const { columns, monthLabels } = buildHeatmapGrid(daily, now ?? Date.now());
  const colW = cell + GAP;
  const width = columns.length * colW;
  // Weekday axis: short names, blanking every other row (Mon / Wed / Fri shown).
  const weekdayAxis = getWeekdayNames("short").map((label, i) => (i % 2 === 1 ? label : ""));

  return (
    <div className={className}>
      <div className="overflow-x-auto pb-1">
        <div className="inline-block">
          <div className="flex" style={{ gap: AXIS_GAP }}>
            <div style={{ width: AXIS_W }} />
            <div className="relative" style={{ width, height: MONTH_ROW_H }}>
              {monthLabels.map((label) => (
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
              {weekdayAxis.map((label, row) => (
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
              {columns.map((column, col) => (
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
      <div className="mt-3 flex items-center justify-end gap-1.5">
        <Caption className="text-fg-subtle">{t("heatmap.less")}</Caption>
        {([0, 1, 2, 3, 4] as HeatmapLevel[]).map((level) => (
          <div
            key={level}
            className={cn("rounded-[2px]", LEVEL_CLASS[level])}
            style={{ width: cell, height: cell }}
          />
        ))}
        <Caption className="text-fg-subtle">{t("heatmap.more")}</Caption>
      </div>
    </div>
  );
}
