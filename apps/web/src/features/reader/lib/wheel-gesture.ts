/**
 * Turns a continuous wheel/trackpad delta stream into discrete, once-per-gesture
 * triggers. A trackpad swipe is not one event but a burst: the drag itself, then
 * a long momentum tail of decaying deltas. Acting on every event would cascade a
 * single flick into many page turns / navigator steps, so this accumulates the
 * travel, fires once at the threshold, and stays latched until the gesture ends.
 *
 * A gesture ends when the stream goes quiet (`quietMs` without an event). Two
 * cues end it early, because a user re-swiping mid-momentum never pauses:
 * - a direction reversal — momentum never flips sign, so an opposite delta is
 *   deliberate input;
 * - a decay-then-rise: momentum decays monotonically (touching the trackpad
 *   cancels it outright on macOS), while a fresh drag ramps up from small
 *   deltas. So once the magnitude has fallen well below the gesture's peak
 *   ("armed"), two consecutive meaningful rises read as a new swipe. A steady
 *   continuous scroll never dips, never arms, and so still fires only once.
 *
 * Purely timestamp-driven (no timers): feed each event's delta with its
 * `timeStamp` and act on the returned direction.
 */

export type WheelGestureStep = -1 | 0 | 1;

export type WheelGesture = {
  /** Feed one event's delta; returns the step to take now (0 = none). */
  feed: (delta: number, timeMs: number) => WheelGestureStep;
  reset: () => void;
};

type WheelGestureOptions = {
  /** Accumulated travel (px) at which the gesture fires. */
  threshold: number;
  /** A pause in the stream longer than this ends the gesture. */
  quietMs?: number;
};

const DEFAULT_QUIET_MS = 250;
// The rise detector arms once the magnitude falls to this fraction of the
// gesture's peak — i.e. once we're clearly into a decaying tail (or the tail
// was cancelled by a new touch, whose drag starts small).
const ARM_FRACTION = 0.5;
// A "rise" is an event this much above the previous one; tail noise stays
// below it, a fresh drag's ramp-up clears it easily.
const RISE_FACTOR = 1.15;
const RISE_STREAK_TO_RESTART = 2;
// The restarting event must also be this large, so late-tail flutter
// (rises between tiny deltas) can't restart the gesture.
const RESTART_MIN_DELTA = 24;
// Opposite-direction deltas below this are jitter, not a reversal.
const REVERSE_MIN_DELTA = 4;

export function createWheelGesture({
  threshold,
  quietMs = DEFAULT_QUIET_MS,
}: WheelGestureOptions): WheelGesture {
  let accum = 0;
  let firedDirection: WheelGestureStep = 0;
  let lastEventAt = Number.NEGATIVE_INFINITY;
  // Latched-phase state for the decay-then-rise detector.
  let peak = 0;
  let armed = false;
  let risingStreak = 0;
  let lastMagnitude = 0;

  const reset = () => {
    accum = 0;
    firedDirection = 0;
    peak = 0;
    armed = false;
    risingStreak = 0;
    lastMagnitude = 0;
  };

  const feed = (delta: number, timeMs: number): WheelGestureStep => {
    if (timeMs - lastEventAt > quietMs) reset();
    lastEventAt = timeMs;
    const magnitude = Math.abs(delta);
    if (magnitude === 0) return 0;
    const direction: WheelGestureStep = delta > 0 ? 1 : -1;

    if (firedDirection !== 0) {
      const reversed = direction !== firedDirection && magnitude >= REVERSE_MIN_DELTA;
      peak = Math.max(peak, magnitude);
      if (magnitude <= peak * ARM_FRACTION) armed = true;
      risingStreak = armed && magnitude > lastMagnitude * RISE_FACTOR ? risingStreak + 1 : 0;
      const restarted = risingStreak >= RISE_STREAK_TO_RESTART && magnitude >= RESTART_MIN_DELTA;
      lastMagnitude = magnitude;
      if (!reversed && !restarted) return 0;
      reset();
    }

    // A direction change while still accumulating starts the count over.
    if (accum !== 0 && direction !== Math.sign(accum)) accum = 0;
    accum += delta;
    if (Math.abs(accum) < threshold) return 0;

    firedDirection = direction;
    peak = magnitude;
    lastMagnitude = magnitude;
    accum = 0;
    return firedDirection;
  };

  return { feed, reset };
}
