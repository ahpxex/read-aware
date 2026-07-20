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
 * - a magnitude jump — momentum decays monotonically, so a delta clearly above
 *   the decayed envelope of the tail is a fresh swipe in the same direction.
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
// Envelope of the momentum tail: tracks recent delta magnitude, decaying so an
// aging tail lowers the bar for recognizing the next deliberate swipe.
const ENVELOPE_DECAY = 0.8;
// A same-direction delta this far above the envelope is a fresh swipe…
const RESTART_FACTOR = 2;
// …but never below this floor, so late-tail noise can't restart the gesture.
const RESTART_MIN_DELTA = 24;
// Opposite-direction deltas below this are jitter, not a reversal.
const REVERSE_MIN_DELTA = 4;

export function createWheelGesture({
  threshold,
  quietMs = DEFAULT_QUIET_MS,
}: WheelGestureOptions): WheelGesture {
  let accum = 0;
  let envelope = 0;
  let firedDirection: WheelGestureStep = 0;
  let lastEventAt = Number.NEGATIVE_INFINITY;

  const reset = () => {
    accum = 0;
    envelope = 0;
    firedDirection = 0;
  };

  const feed = (delta: number, timeMs: number): WheelGestureStep => {
    if (timeMs - lastEventAt > quietMs) reset();
    lastEventAt = timeMs;
    const magnitude = Math.abs(delta);
    if (magnitude === 0) {
      envelope *= ENVELOPE_DECAY;
      return 0;
    }
    const direction: WheelGestureStep = delta > 0 ? 1 : -1;

    if (firedDirection !== 0) {
      const reversed = direction !== firedDirection && magnitude >= REVERSE_MIN_DELTA;
      const restarted =
        direction === firedDirection &&
        magnitude >= RESTART_MIN_DELTA &&
        magnitude > envelope * RESTART_FACTOR;
      if (!reversed && !restarted) {
        envelope = Math.max(magnitude, envelope * ENVELOPE_DECAY);
        return 0;
      }
      reset();
    }

    // A direction change while still accumulating starts the count over.
    if (accum !== 0 && direction !== Math.sign(accum)) accum = 0;
    accum += delta;
    if (Math.abs(accum) < threshold) return 0;

    firedDirection = direction;
    envelope = magnitude;
    accum = 0;
    return firedDirection;
  };

  return { feed, reset };
}
