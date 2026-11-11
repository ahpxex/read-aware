// READAWARE: how a touch drag across a paginated layout settles. Upstream
// Foliate snapped to `centre + velocity × page`, with the velocity taken from
// the last two touchmove samples only. A finger slows before it lifts, so on
// 90–120 Hz touch screens that last interval reads ~0 and a page turned only
// after a drag past half the page; a hard flick could skip a page instead.
// Platform pagers (Android's ViewPager, iOS page views) settle from a
// windowed release velocity plus a distance fallback, and move one page at most.

/** A point of a page drag: its event time and the finger's travel so far, in
 * reading order (positive = toward the next page), in CSS pixels. */
export type SwipeSample = { t: number; travel: number };

/** The release velocity is measured over at least this much of the drag's end,
 * so a finger easing off just before it lifts still reads as the flick it was. */
export const SWIPE_VELOCITY_WINDOW_MS = 100;
/** A release at least this fast (CSS px/ms, i.e. 250 px/s) is a flick. */
export const SWIPE_FLING_MIN_VELOCITY = 0.25;
/** A flick must also have travelled this far, so a jittery tap never turns. */
export const SWIPE_FLING_MIN_TRAVEL = 24;
/** Without a flick, a drag past this fraction of the page turns it. */
export const SWIPE_DRAG_TURN_RATIO = 0.25;

/** Travel per millisecond across the last {@link SWIPE_VELOCITY_WINDOW_MS}:
 * from the latest sample at least that old (or the drag's start) to the release. */
export const swipeReleaseVelocity = (samples: readonly SwipeSample[]): number => {
  const last = samples.at(-1);
  if (!last) return 0;
  let base = samples[0] ?? last;
  for (const sample of samples) {
    if (last.t - sample.t < SWIPE_VELOCITY_WINDOW_MS) break;
    base = sample;
  }
  const elapsed = last.t - base.t;
  return elapsed > 0 ? (last.travel - base.travel) / elapsed : 0;
};

/** The page step a released drag settles on: +1 next, -1 previous, 0 back to
 * the page it started from. A flick decides by its direction (against the drag
 * it cancels the turn); otherwise the drag must cover enough of the page. */
export const swipePageStep = (samples: readonly SwipeSample[], pageSize: number): -1 | 0 | 1 => {
  const travel = samples.at(-1)?.travel ?? 0;
  if (travel === 0) return 0;
  const direction = travel > 0 ? 1 : -1;
  const velocity = swipeReleaseVelocity(samples);
  if (Math.abs(velocity) >= SWIPE_FLING_MIN_VELOCITY && Math.abs(travel) >= SWIPE_FLING_MIN_TRAVEL)
    return Math.sign(velocity) === direction ? direction : 0;
  return Math.abs(travel) >= pageSize * SWIPE_DRAG_TURN_RATIO ? direction : 0;
};

/** READAWARE: a discrete swipe (the renderer's `discrete-swipe` attribute,
 * set for e-ink panels) leaves the page still under the finger, so the reader
 * never sees a drag to judge: any deliberate horizontal travel turns. The
 * same distance the host takes as a deliberate move rather than a tap. */
export const SWIPE_DISCRETE_MIN_TRAVEL = 48;

/** The page step a released discrete swipe turns: the direction of the
 * finger's net travel once it is deliberate, else none. */
export const discreteSwipeStep = (samples: readonly SwipeSample[]): -1 | 0 | 1 => {
  const travel = samples.at(-1)?.travel ?? 0;
  if (Math.abs(travel) < SWIPE_DISCRETE_MIN_TRAVEL) return 0;
  return travel > 0 ? 1 : -1;
};
