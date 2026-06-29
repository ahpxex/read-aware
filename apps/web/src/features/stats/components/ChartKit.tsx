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

type ChartRow = { ms: number; sub?: string; caption?: string };

type DurationTooltipProps = {
  active?: boolean;
  payload?: { payload: ChartRow }[];
};

/** Quiet paper-toned tooltip showing a formatted duration plus optional context. */
export function DurationTooltip({ active, payload }: DurationTooltipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-paper px-2.5 py-1.5 text-xs shadow-sm">
      <div className="font-medium tabular-nums text-fg">{formatReadingDuration(row.ms)}</div>
      {row.sub && <div className="tabular-nums text-fg-subtle">{row.sub}</div>}
      {row.caption && <div className="text-fg-subtle">{row.caption}</div>}
    </div>
  );
}
