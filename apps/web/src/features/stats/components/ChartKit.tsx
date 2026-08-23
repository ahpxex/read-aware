import { formatReadingDuration } from "../../reader/lib/reading-stats";

/**
 * Shared recharts styling for the stats charts. Colors resolve to the theme's
 * CSS variables so charts invert correctly in dark mode; everything stays
 * monochrome ink-on-paper, in keeping with the editorial design system.
 */
export const INK = {
  fg: "var(--color-fg)",
  subtle: "var(--color-fg-subtle)",
  border: "var(--color-border)",
} as const;

/** Bar fill: empty buckets read as a faint rule, the emphasized bar as solid ink. */
export function barFill(ms: number, emphasized: boolean): string {
  if (!(ms > 0)) return INK.border;
  return emphasized ? INK.fg : INK.subtle;
}

/** Recharts cursor highlight behind the hovered bar. */
export const BAR_CURSOR = { fill: "var(--color-fill)", opacity: 0.6 } as const;

/**
 * Shared plot margins for every stats bar chart. `useActiveBar` maps click
 * coordinates onto bar columns with these same numbers, so charts must not
 * override them ad hoc.
 */
export const CHART_MARGIN = { top: 6, right: 2, bottom: 0, left: 2 } as const;

type ChartRow = { ms: number; sub?: string; caption?: string };

type DurationTooltipProps = {
  active?: boolean;
  payload?: { payload: ChartRow }[];
};

/**
 * Pin the tooltip to the top edge of the plot (x keeps tracking the active
 * column). Pass to every stats chart's <Tooltip position> so the label reads
 * like a caption above the bars instead of a card chasing the pointer.
 */
export const TOOLTIP_POSITION = { y: 0 } as const;

/** Solid ink label showing a formatted duration plus optional context. */
export function DurationTooltip({ active, payload }: DurationTooltipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-sm bg-fg px-2 py-1 text-xs text-inverse-fg">
      <span className="font-medium tabular-nums">{formatReadingDuration(row.ms)}</span>
      {(row.sub ?? row.caption) && (
        <span className="tabular-nums opacity-70"> · {row.sub ?? row.caption}</span>
      )}
    </div>
  );
}
