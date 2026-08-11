import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useActiveBar } from "../hooks/useActiveBar";
import type { StatsBar } from "../lib/reading-insights";
import { BAR_CURSOR, barFill, CHART_MARGIN, DurationTooltip, INK, TOOLTIP_POSITION } from "./ChartKit";

type ReadingBarsProps = {
  bars: StatsBar[];
  /** Chart height in px (default 160). */
  height?: number;
  className?: string;
};

/**
 * Reading-time bar chart over a bucket series, with the "current" bucket inked
 * darker. Built on recharts for clean axes, hover tooltips, and responsive
 * sizing; styled monochrome to match the design system. The bucket series itself
 * is derived in `reading-insights`.
 */
export function ReadingBars({ bars, height = 160, className }: ReadingBarsProps) {
  const dense = bars.length > 14;

  const data = bars.map((bar) => ({
    key: bar.key,
    label: bar.label,
    ms: bar.ms,
    isCurrent: bar.isCurrent,
    caption: bar.key,
  }));
  const labelByKey = new Map(data.map((d) => [d.key, d.label]));
  const { onChartClick, isEmphasized } = useActiveBar(data.map((d) => d.key));

  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={CHART_MARGIN}
          barCategoryGap={dense ? "12%" : "22%"}
          onClick={onChartClick}
        >
          <XAxis
            dataKey="key"
            tickFormatter={(k: string) => labelByKey.get(k) ?? ""}
            interval={dense ? Math.floor(data.length / 8) : 0}
            tickLine={false}
            axisLine={{ stroke: INK.border }}
            tick={{ fontSize: 10, fill: INK.subtle }}
            minTickGap={4}
          />
          <YAxis hide domain={[0, "dataMax"]} />
          <Tooltip
            cursor={BAR_CURSOR}
            content={<DurationTooltip />}
            position={TOOLTIP_POSITION}
            isAnimationActive={false}
          />
          <Bar dataKey="ms" radius={[2, 2, 0, 0]} maxBarSize={30} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.key} fill={barFill(d.ms, isEmphasized(d.key, d.isCurrent))} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
