import { AppError, type ReadingModePosition, type ReadingModeStepOutcome } from "@read-aware/core";

export type TextUnitStepIndex = {
  sectionIndex: number;
  count: number;
  currentIndex: number;
  visibleIndex: number;
  /**
   * The section is a page shown whole (fixed layout). A step that turns to
   * one stops there even when it has no unit to rest on: a figure, a blank
   * leaf, a page that is a scan. Flowing text has no such pages — a section
   * without units there is a file with nothing to read, and is passed over.
   */
  page?: boolean;
  position(index: number): ReadingModePosition;
};
export type TextUnitStepAdapter = {
  resting(): ReadingModePosition | null;
  index(signal: AbortSignal): Promise<TextUnitStepIndex>;
  adjacent(sectionIndex: number, direction: -1 | 1): number | null;
  navigate(target: number | ReadingModePosition, signal: AbortSignal): Promise<void>;
  land(position: ReadingModePosition, signal: AbortSignal): Promise<void>;
  /** Rest on no unit: the step stopped on a page that has none. */
  vacate(): void;
};

/** Traversal policy is independent of renderer layout and plugin segmentation. */
export async function stepTextUnit(
  adapter: TextUnitStepAdapter,
  direction: -1 | 1,
  signal: AbortSignal,
): Promise<ReadingModeStepOutcome> {
  const check = () => {
    if (signal.aborted) throw signal.reason;
  };
  check();
  const resting = adapter.resting();
  if (resting) {
    await adapter.navigate(resting, signal);
    check();
    await adapter.land(resting, signal);
  }
  check();
  let index = await adapter.index(signal);
  check();
  let target = index.currentIndex < 0 ? index.visibleIndex : index.currentIndex + direction;
  const visited = new Set<number>();
  while (target < 0 || target >= index.count) {
    check();
    if (visited.has(index.sectionIndex))
      throw new AppError("reader/invalid-target", "Reading section traversal did not advance");
    visited.add(index.sectionIndex);
    const next = adapter.adjacent(index.sectionIndex, direction);
    if (next === null) return direction === 1 ? "end-of-book" : "start-of-book";
    await adapter.navigate(next, signal);
    check();
    index = await adapter.index(signal);
    check();
    if (index.sectionIndex !== next)
      throw new AppError("reader/target-not-found", "Reader did not enter the requested section");
    // One step turns at most one page: without this, stepping into a run of
    // text-less pages would page through all of them — a scanned book, to its end.
    if (index.page && !index.count) {
      adapter.vacate();
      return "moved";
    }
    target = direction === 1 ? 0 : index.count - 1;
  }
  const position = index.position(target);
  await adapter.navigate(position, signal);
  check();
  await adapter.land(position, signal);
  check();
  return "moved";
}
