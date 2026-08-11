import { useCallback, useState } from "react";
import type { MouseHandlerDataParam } from "recharts";

/**
 * Click-to-move emphasis for the stats bar charts. The inked bar defaults to
 * the chart's own notion of "current" (today, this month, the peak hour);
 * clicking / tapping a bar moves the ink there and it stays put — clicks
 * outside any bar column change nothing.
 */
export function useActiveBar() {
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const onChartClick = useCallback((state: MouseHandlerDataParam) => {
    const label = state.activeLabel;
    if (label === undefined || label === null) return;
    setActiveKey(String(label));
  }, []);

  /** Whether `key` is the emphasized bar, given the chart's default choice. */
  const isEmphasized = useCallback(
    (key: string, isDefault: boolean) => (activeKey === null ? isDefault : activeKey === key),
    [activeKey],
  );

  return { onChartClick, isEmphasized };
}
