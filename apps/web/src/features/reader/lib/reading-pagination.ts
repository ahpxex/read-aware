import type { ReadingPaginationSnapshot } from "@read-aware/core";
import type { FoliateRelocateDetail, FoliateView } from "./foliate-engine";

/** Present one-based positions. Fixed-layout sections are source pages;
 * reflowable engine locations are zero-based estimates of text size. */
export function readingPagePosition(
  fixedLayout: boolean,
  detail: Pick<FoliateRelocateDetail, "section" | "location">,
): { current: number; total: number } {
  if (fixedLayout) return { current: detail.section.current + 1, total: detail.section.total };
  const { current, total } = detail.location;
  return { current: total > 0 ? Math.min(total, current + 1) : 0, total };
}

/** Names the page a whole-book position (0..1) falls on; null where there is none to name. */
export type ReadingPageLocator = (fraction: number) => number | null;

/**
 * The page a position falls on, by the engine's own count, so it is the
 * number the reader reports once it is there. Estimating it from the page
 * total is off by one about half the time: the total is rounded up, and a
 * page is counted from where it starts, not to the nearest.
 */
export function readingPageLocator(
  view: Pick<FoliateView, "isFixedLayout" | "getProgressAtFraction">,
): ReadingPageLocator {
  return (fraction) => {
    const progress = view.getProgressAtFraction(Math.min(1, Math.max(0, fraction)));
    if (!progress) return null;
    const { current, total } = readingPagePosition(view.isFixedLayout, progress);
    return total > 0 ? current : null;
  };
}

/** Read the renderer's current geometry, never estimate unrendered sections. */
export function readingPagination(view: FoliateView): ReadingPaginationSnapshot | null {
  const renderer = view.renderer,
    index = view.lastLocation?.section.current,
    count = view.book?.sections.length;
  if (
    !renderer ||
    index === undefined ||
    count === undefined ||
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    index < 0 ||
    index >= count
  )
    return null;
  const layout = view.isFixedLayout ? "fixed" : "reflowable";
  const flow = renderer.scrolled ? "scrolled" : "paginated";
  let screen: ReadingPaginationSnapshot["screen"] = null;
  // A long section is laid out around the reader first: until it is whole,
  // its page count is how far the layout has come, not how long the section is.
  const whole = !("laidOut" in renderer) || renderer.laidOut;
  if (whole && layout === "reflowable" && flow === "paginated" && "pages" in renderer && "page" in renderer) {
    // Foliate's paginator has one leading and one trailing navigation pad.
    // A viewport may contain multiple columns; it is still one screen step.
    const pages = renderer.pages,
      page = renderer.page;
    if (Number.isSafeInteger(pages) && Number.isSafeInteger(page) && pages > 2 && page >= 1 && page < pages - 1) {
      screen = { index: page - 1, count: pages - 2 };
    }
  }
  return { layout, flow, section: { index, count }, screen };
}
