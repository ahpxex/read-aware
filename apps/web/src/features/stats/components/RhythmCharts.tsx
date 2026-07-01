import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Caption } from "@read-aware/ui";
import { formatHour, useTranslation } from "../../../i18n";
import type { WeekdayBucket } from "../lib/reading-insights";
import { BAR_CURSOR, barFill, DurationTooltip, INK } from "./ChartKit";

const CHART_H = 110;
/** Hour-axis ticks (others stay unlabelled). */
const HOUR_TICKS = ["0", "6", "12", "18"];

/**
 * Reading time by weekday (Mon→Sun), the busiest day inked darker. Only
 * meaningful once the window spans several weeks, so callers hide it on the
 * week view where it would just restate the daily bars.
 */
export function WeekdayChart({ weekday, className }: { weekday: WeekdayBucket[]; className?: string }) {
  const { t } = useTranslation("stats");
  const max = Math.max(1, ...weekday.map((d) => d.ms));
  const data = weekday.map((d) => ({
    key: d.full,
    label: d.label,
    ms: d.ms,
    isPeak: d.ms === max && d.ms > 0,
    caption: d.full,
  }));
  const labelByKey = new Map(data.map((d) => [d.key, d.label]));

  return (
    <div className={className}>
      <Caption className="mb-2 block text-fg-subtle">{t("rhythm.byWeekday")}</Caption>
      <div style={{ height: CHART_H }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 2, bottom: 0, left: 2 }} barCategoryGap="22%">
            <XAxis
              dataKey="key"
              tickFormatter={(k: string) => labelByKey.get(k) ?? ""}
              interval={0}
              tickLine={false}
              axisLine={{ stroke: INK.border }}
              tick={{ fontSize: 10, fill: INK.subtle }}
            />
            <YAxis hide domain={[0, "dataMax"]} />
            <Tooltip cursor={BAR_CURSOR} content={<DurationTooltip />} />
            <Bar dataKey="ms" radius={[2, 2, 0, 0]} maxBarSize={26} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.key} fill={barFill(d.ms, d.isPeak)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * All-time reading time by local hour-of-day, the peak hour inked darker. The
 * histogram accrues going forward; until it has data, shows a quiet note.
 */
export function TimeOfDayChart({ byHour, className }: { byHour: number[]; className?: string }) {
  const { t } = useTranslation("stats");
  const max = Math.max(1, ...byHour);
  const hasData = byHour.some((ms) => ms > 0);
  const peak = hasData ? byHour.indexOf(max) : -1;
  const data = byHour.map((ms, h) => ({
    key: String(h),
    ms,
    isPeak: ms === max && ms > 0,
    caption: formatHour(h),
  }));

  return (
    <div className={className}>
      <Caption className="mb-2 block text-fg-subtle">
        {t("rhythm.byTimeOfDay")}
        {peak >= 0 ? ` · ${t("rhythm.peak", { hour: formatHour(peak) })}` : ""}
      </Caption>
      {hasData ? (
        <div style={{ height: CHART_H }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 6, right: 2, bottom: 0, left: 2 }} barCategoryGap="8%">
              <XAxis
                dataKey="key"
                ticks={HOUR_TICKS}
                tickFormatter={(k: string) => formatHour(Number(k))}
                interval={0}
                tickLine={false}
                axisLine={{ stroke: INK.border }}
                tick={{ fontSize: 9, fill: INK.subtle }}
              />
              <YAxis hide domain={[0, "dataMax"]} />
              <Tooltip cursor={BAR_CURSOR} content={<DurationTooltip />} />
              <Bar dataKey="ms" radius={[1, 1, 0, 0]} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.key} fill={barFill(d.ms, d.isPeak)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex items-center text-fg-subtle" style={{ height: CHART_H }}>
          <Caption>{t("rhythm.buildsUp")}</Caption>
        </div>
      )}
    </div>
  );
}
