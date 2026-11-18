/**
 * Zoom input for fixed-layout books (PDF, comics): the steps a key or button
 * moves through and the continuous factor a pinch or ctrl+wheel produces. The
 * model itself — a fit and a factor over it — is the engine's
 * (`foliate-js/src/fixed-zoom.ts`), imported directly because it is pure; the
 * per-book memory of it is `domain/reading-zoom.ts`.
 */
import {
  DEFAULT_FIXED_LAYOUT_ZOOM,
  ZOOM_FACTOR_MAX,
  ZOOM_FACTOR_MIN,
  clampZoomFactor,
  normalizeFixedLayoutZoom,
  resolveFixedLayoutFit,
  sameFixedLayoutZoom,
  type FixedLayoutFit,
  type FixedLayoutZoom,
  type PanAxis,
} from "../../../../foliate-js/src/fixed-zoom";
import type { TFunction } from "i18next";

export {
  DEFAULT_FIXED_LAYOUT_ZOOM,
  ZOOM_FACTOR_MAX,
  ZOOM_FACTOR_MIN,
  clampZoomFactor,
  normalizeFixedLayoutZoom,
  resolveFixedLayoutFit,
  sameFixedLayoutZoom,
  type FixedLayoutFit,
  type FixedLayoutZoom,
  type PanAxis,
};

/** The factors a zoom-in/out step lands on — the familiar viewer ladder. */
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6] as const;

/**
 * The next step past `factor` in `direction`. A factor between steps (left by
 * a pinch) moves to the nearest step that way rather than a whole step on.
 */
export function stepZoomFactor(factor: number, direction: 1 | -1): number {
  // Tolerance, so a factor a hair off a step still counts as on it.
  const epsilon = 0.005;
  if (direction > 0) return ZOOM_STEPS.find((step) => step > factor + epsilon) ?? ZOOM_FACTOR_MAX;
  return ZOOM_STEPS.findLast((step) => step < factor - epsilon) ?? ZOOM_FACTOR_MIN;
}

/**
 * The factor a ctrl+wheel event scales by. Chromium reports a trackpad pinch
 * as ctrl+wheel with `deltaY = -100·ln(scale)`, which this inverts exactly;
 * a mouse wheel turned with the zoom chord held reports ~100 a notch, which
 * the per-event cap turns into a step of about 18%.
 */
const WHEEL_ZOOM_EVENT_CAP = 20;
export function wheelZoomRatio(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-WHEEL_ZOOM_EVENT_CAP, Math.min(WHEEL_ZOOM_EVENT_CAP, pixels)) / 100);
}

/**
 * Whether a wheel event may pan a zoomed page whose view is locked along
 * `lockedAxis` (null: not locked). An event that runs mostly along the locked
 * axis is a page turn, as at the fit — panning the page by its drift the
 * other way would spend the gesture on a few pixels, and a sideways swipe
 * over a locked column would never turn the page.
 */
export const wheelPansView = (deltaX: number, deltaY: number, lockedAxis: PanAxis | null): boolean =>
  lockedAxis === null || (Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y") !== lockedAxis;

/** The label a zoom shows: its factor as a percentage of the fit. */
export const zoomPercent = (factor: number): number => Math.round(factor * 100);

/** What a page's 100% can fit to — its width, or the whole page. */
export function pageFitOptions(t: TFunction<"reader">): { value: Exclude<FixedLayoutFit, "auto">; label: string }[] {
  return (["width", "page"] as const).map((value) => ({ value, label: t(`pageFitOption.${value}`) }));
}
