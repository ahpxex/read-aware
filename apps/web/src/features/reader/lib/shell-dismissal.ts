/**
 * When a relocation should dismiss the reader chrome.
 *
 * Paginated reading treats a page turn as "the reader has started reading
 * again", so the header slides away the moment the position moves — whether the
 * turn came from a swipe, an edge button, or the arrow keys. Continuous scroll
 * is deliberately not routed through here: it dismisses on accumulated scroll
 * distance instead, so a nudge keeps the header.
 *
 * Two independent tests have to agree, because either alone is wrong:
 *
 * - The engine's `reason` separates a turn from a **re-layout**. Anything that
 *   changes the viewport — the phone's soft keyboard, rotation, a font-size
 *   change — re-flows the section and reports a fresh visible range at the same
 *   reading position (`anchor`). By position alone that is indistinguishable
 *   from a page turn, which is how the AI chat panel used to shut the header a
 *   heartbeat after every tap: revealing it raised the keyboard, and the
 *   keyboard "turned the page".
 * - The position delta rules out the no-op `snap` the engine reports right
 *   after a tap that did not move anything.
 */

import type { FoliateRelocateReason } from "./foliate-engine";

/** The position a relocation reports, reduced to what dismissal cares about. */
export type ReadingLocation = {
  current: number;
  cfi: string | null;
};

/**
 * Reasons that mean the reader moved rather than the text re-flowed under it.
 * `anchor` is a re-layout; `navigation` and `selection` are programmatic jumps
 * the app itself issued, and a missing reason (a fixed-layout `goTo`) is the
 * same kind of jump.
 */
const MOVED_REASONS: readonly FoliateRelocateReason[] = ["page", "snap", "scroll"];

export function relocateDismissesShell({
  reason,
  previous,
  next,
}: {
  reason: FoliateRelocateReason | undefined;
  /** The position the previous relocation reported; null before the first one. */
  previous: ReadingLocation | null;
  next: ReadingLocation;
}): boolean {
  if (previous == null) return false;
  if (reason === undefined || !MOVED_REASONS.includes(reason)) return false;

  const movedPage = next.current !== previous.current;
  const movedCfi = next.cfi != null && previous.cfi != null && next.cfi !== previous.cfi;
  return movedPage || movedCfi;
}
