import { useCallback, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { CHART_MARGIN } from "../components/ChartKit";

/**
 * Click-to-move emphasis for the stats bar charts. The inked bar defaults to
 * the chart's own notion of "current" (today, this month, the peak hour);
 * clicking / tapping anywhere in a bar's column moves the ink there and it
 * stays put.
 *
 * The column is resolved from the pointer position, not from recharts'
 * `activeLabel`: the tooltip state behind that field updates on a rAF-throttled
 * mousemove, and a touch tap fires its synthesized mousemove → click burst
 * within one frame — so at click time the state is still one tap behind.
 *
 * `keys` must be the bar keys in render order; the whole plot width is split
 * evenly between them, which matches recharts' categorical band layout as long
 * as the chart uses `CHART_MARGIN`.
 */
export function useActiveBar(keys: readonly string[]) {
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const onChartClick = useCallback(
    (_state: unknown, event: ReactMouseEvent<Element>) => {
      if (keys.length === 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const plotWidth = rect.width - CHART_MARGIN.left - CHART_MARGIN.right;
      if (plotWidth <= 0) return;
      const x = event.clientX - rect.left - CHART_MARGIN.left;
      const index = Math.min(keys.length - 1, Math.max(0, Math.floor((x / plotWidth) * keys.length)));
      setActiveKey(keys[index]);
    },
    [keys],
  );

  /** Whether `key` is the emphasized bar, given the chart's default choice. */
  const isEmphasized = useCallback(
    (key: string, isDefault: boolean) => (activeKey === null ? isDefault : activeKey === key),
    [activeKey],
  );

  return { onChartClick, isEmphasized };
}
