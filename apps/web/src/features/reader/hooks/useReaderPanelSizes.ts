import { useCallback } from "react";
import { useAtom } from "jotai";
import {
  clampPanelWidth,
  readerPanelSizesAtom,
  saveReaderPanelSizes,
  type ReaderPanelSizes,
} from "../lib/reader-panel-sizes";

/**
 * Live, drag-adjustable widths for the reader's side panels. `adjust` applies an
 * incremental drag delta (clamped) for snappy resizing; `persist` writes the
 * final widths to storage on release.
 */
export function useReaderPanelSizes() {
  const [sizes, setSizes] = useAtom(readerPanelSizesAtom);

  const adjust = useCallback(
    (key: keyof ReaderPanelSizes, deltaPx: number) => {
      setSizes((prev) => ({ ...prev, [key]: clampPanelWidth(prev[key] + deltaPx) }));
    },
    [setSizes],
  );

  const persist = useCallback(() => {
    // Read the latest value through the setter, write it, leave it unchanged.
    setSizes((prev) => {
      saveReaderPanelSizes(prev);
      return prev;
    });
  }, [setSizes]);

  return { sizes, adjust, persist };
}
