/**
 * The way back after a jump: where the reader was reading before a chapter,
 * a search hit, a note, a link or the progress bar took them elsewhere.
 *
 * The place is the one the reader left first. Looking through several search
 * hits or notes in a row keeps offering the spot the reading stopped at, not
 * the hit before this one (the jump history's Back steps through those).
 * Stepping through that history is the reader finding their own way, and
 * ends the offer.
 */
import type { ReadingLocation } from "@read-aware/core";
import type { ReadingHistoryMove } from "../../../domain/reading-session-controller";
import type { ReadingCursor } from "./reader-types";

export type JumpReturn = {
  sessionId: string;
  location: ReadingLocation;
  /** The page the header showed there; null when the book has none, or it was not seen. */
  page: number | null;
};

/**
 * The offer after a move through the jump history, given the one before it.
 * `pageAt` names the page of the place a new jump left.
 */
export function jumpReturnAfter(
  current: JumpReturn | null,
  move: ReadingHistoryMove,
  pageAt: (location: ReadingLocation) => number | null,
): JumpReturn | null {
  if (move.kind !== "jump") return null;
  if (current?.sessionId === move.sessionId) return current;
  return { sessionId: move.sessionId, location: move.from, page: pageAt(move.from) };
}

/** A jump leaves a place the reader was shown moments before; nothing older is asked for. */
const REMEMBERED_PLACES = 32;

/**
 * The page number the reader reported at each place it was recently at. A
 * page cannot be worked out from a location afterwards: the engine counts
 * pages from where a screen starts and reports the fraction of where it
 * ends, so the two disagree by one about half the time. Asking what was
 * shown there gives the number the header showed.
 */
export function createPageMemory(): {
  remember(cursor: ReadingCursor | null): void;
  pageAt(location: ReadingLocation): number | null;
} {
  const pages = new Map<string, number>();
  return {
    remember(cursor) {
      const place = cursor?.anchor,
        page = cursor?.location?.current;
      if (!place || !page) return;
      pages.delete(place);
      pages.set(place, page);
      for (const oldest of pages.keys()) {
        if (pages.size <= REMEMBERED_PLACES) break;
        pages.delete(oldest);
      }
    },
    pageAt: (location) => (location.cfi ? (pages.get(location.cfi) ?? null) : null),
  };
}
