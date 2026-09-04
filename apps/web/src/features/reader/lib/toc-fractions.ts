import type { FoliateResolved, FoliateView } from "./foliate-engine";
import type { TocEntry } from "./reader-types";

const isThenable = (value: unknown): value is Promise<unknown> =>
  typeof (value as { then?: unknown } | null)?.then === "function";

/**
 * Stamp each table-of-contents entry with its position in the book as a 0..1
 * fraction, so the header's progress bar can mark chapter boundaries and name
 * the chapter a scrub would land in without querying the engine per pointer
 * move.
 *
 * The fractions come from the engine's section sizes — the same scale
 * `goToFraction` consumes, so a tick and the jump it invites agree. Formats
 * whose href resolution is asynchronous (PDF) or which expose no section sizes
 * leave the fraction undefined; the bar then simply carries no marks.
 */
export function attachTocFractions(view: FoliateView, entries: TocEntry[]): TocEntry[] {
  const sectionFractions = view.getSectionFractions?.() ?? [];
  if (sectionFractions.length === 0) return entries;

  const splitTOCHref = view.book?.splitTOCHref?.bind(view.book);
  return entries.map((entry) => {
    let index: number | undefined;
    // The engine's TOC splitter is synchronous for every format and answers
    // with a section index for MOBI/KF8, whose `resolveHref` is async (and
    // would leave those books without chapter marks).
    if (splitTOCHref) {
      try {
        const first = splitTOCHref(entry.href)?.[0];
        if (typeof first === "number" && first >= 0) index = first;
      } catch {
        index = undefined;
      }
    }
    if (index === undefined) {
      let resolved: FoliateResolved | Promise<unknown> | null | undefined;
      try {
        resolved = view.resolveNavigation?.(entry.href);
      } catch {
        resolved = null;
      }
      if (!resolved || isThenable(resolved)) return entry;
      index = resolved.index;
    }

    const fraction = sectionFractions[index];
    return typeof fraction === "number" ? { ...entry, fraction } : entry;
  });
}
