import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { SelectionRenderBarrier } from "../lib/selection-render-barrier";
import type { ReaderSelectionState } from "../lib/selection-overlay";

export function useSelectionRender(selection: ReaderSelectionState | null, desired: RefObject<ReaderSelectionState | null>) {
  const [barrier] = useState(() => new SelectionRenderBarrier());
  useLayoutEffect(() => barrier.acknowledge(selection, desired.current), [barrier, desired, selection]);
  useEffect(() => () => barrier.retire(), [barrier]);
  return barrier;
}
