// READAWARE: the zoom of a fixed-layout book (PDF, comics), shared by the
// renderer and the app. Pure — no DOM — so the app imports it directly, the
// way it imports the chapter map, instead of through the engine loader.
//
// A zoom is a FIT plus a FACTOR over it. The fit says what "100%" means —
// the page's width across the reading area, or the whole page inside it —
// and the factor scales from there. Relative rather than absolute, because
// what a reader wants from a page is a relation to their window ("a bit
// larger than full width"), which stays true when the window changes; a
// page's absolute size means nothing across PDF points, comic pixels and
// pre-paginated EPUB viewports.
//
// `auto` is the fit each flow has always used: a continuous scroll runs the
// pages full width, a paged flow fits the whole page (or spread) on screen.

export type FixedLayoutFit = "auto" | "width" | "page";
export type FixedLayoutZoom = { fit: FixedLayoutFit; factor: number };

export const ZOOM_FACTOR_MIN = 0.5;
export const ZOOM_FACTOR_MAX = 6;

export const DEFAULT_FIXED_LAYOUT_ZOOM: FixedLayoutZoom = { fit: "auto", factor: 1 };

export const clampZoomFactor = (factor: number): number =>
  Number.isFinite(factor) ? Math.min(ZOOM_FACTOR_MAX, Math.max(ZOOM_FACTOR_MIN, factor)) : 1;

/** Coerce any value into a zoom the renderer can apply. */
export function normalizeFixedLayoutZoom(value: unknown): FixedLayoutZoom {
  if (!value || typeof value !== "object") return DEFAULT_FIXED_LAYOUT_ZOOM;
  const { fit, factor } = value as Partial<Record<keyof FixedLayoutZoom, unknown>>;
  return {
    fit: fit === "width" || fit === "page" ? fit : "auto",
    factor: typeof factor === "number" ? clampZoomFactor(factor) : 1,
  };
}

/** The concrete fit a flow measures against. */
export const resolveFixedLayoutFit = (fit: FixedLayoutFit, scrolled: boolean): "width" | "page" =>
  fit === "auto" ? (scrolled ? "width" : "page") : fit;

export const sameFixedLayoutZoom = (a: FixedLayoutZoom, b: FixedLayoutZoom): boolean =>
  a.fit === b.fit && a.factor === b.factor;

// A zoomed view can be locked (`FixedLayout.setViewLocked`): held still
// across the reading, free along it. A page in a paged flow is read along its
// long side — down a portrait page, across a landscape one — so that is the
// way its locked view still moves, and the lock holds the other axis: the
// column a reader zoomed into stays put while they read through the page and
// on into the next. A square page reads downwards. (A continuous scroll is
// always read downwards, and locks sideways.)
export type PanAxis = "x" | "y";

/** The axis a locked view holds still on a page of this shape. */
export const lockedAxisOfPage = (width: number, height: number): PanAxis => (height >= width ? "x" : "y");
