import type { TocEntry } from "./reader-types";

/**
 * A named position along the book. Backs the progress bar's chapter ticks and
 * the scrub readout that names where a drag would land.
 */
export type ProgressMark = {
  /** Position in the book, 0..1 — the scale `goToFraction` consumes. */
  fraction: number;
  label: string;
};

export const clampFraction = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Chapter marks derived from the table of contents. Entries the engine could
 * not place are dropped. Several chapters packed into one spine file collapse
 * onto that file's start fraction, and the first of them (the shallowest, in
 * reading order) keeps the label — the engine exposes no finer granularity
 * without laying out the section, which a pointer move must not pay for.
 */
export function buildProgressMarks(entries: TocEntry[]): ProgressMark[] {
  const byFraction = new Map<number, ProgressMark>();

  for (const entry of entries) {
    if (entry.fraction == null) continue;
    const fraction = clampFraction(entry.fraction);
    if (byFraction.has(fraction)) continue;
    byFraction.set(fraction, { fraction, label: entry.label });
  }

  return [...byFraction.values()].sort((left, right) => left.fraction - right.fraction);
}

/** The mark a position falls in: the last one at or before it. */
export function findMarkAt(
  marks: ProgressMark[],
  fraction: number,
): ProgressMark | null {
  let found: ProgressMark | null = null;

  for (const mark of marks) {
    // Tolerance: fractions come back from the engine nudged by Number.EPSILON.
    if (mark.fraction > fraction + 1e-9) break;
    found = mark;
  }

  return found;
}

/**
 * The page a position lands on, for the scrub readout. The engine derives its
 * own location number the same way (size-proportional), so rounding here
 * matches what the reader will report once the jump settles.
 */
export function pageAtFraction(fraction: number, totalPages: number): number {
  if (totalPages <= 0) return 0;
  return Math.min(totalPages, Math.max(1, Math.round(fraction * totalPages)));
}
