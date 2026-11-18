import type { WheelPhaseEdge } from "../../../platform/wheel-phase";

/**
 * Turns a continuous wheel/trackpad delta stream into discrete, once-per-gesture
 * triggers. A trackpad swipe is not one event but a burst: the drag itself, then
 * a long momentum tail of decaying deltas. Acting on every event would cascade a
 * single flick into many page turns / navigator steps.
 *
 * The delta stream alone cannot say whether fingers are still on the pad — the
 * one bit that separates "this swipe still coasting" from "a new swipe". So the
 * machine runs in one of two modes:
 *
 * PHASE MODE — active once the host shell reports real gesture phases (the
 * macOS NSEvent monitor, delivered via `platform/wheel-phase.ts`). With ground
 * truth the rules are exact, and timing heuristics play no part while a swipe
 * is coasting:
 * - a new touch starts a new gesture; accumulated travel fires once at the
 *   threshold and the gesture stays latched until the next touch;
 * - momentum may still complete a light swipe that hadn't reached the
 *   threshold, but can never fire a second time — so webview jank that stalls
 *   and clumps the momentum tail cannot fabricate page turns;
 * - a phase-less stream (mouse-wheel notches; trackpads always announce a
 *   touch first) ratchets: every `threshold` of travel steps once.
 *
 * HEURISTIC MODE — everywhere no phase source exists (Windows/Linux trackpads,
 * plain-browser dev), the pre-phase behavior is kept unchanged: accumulate,
 * fire at the threshold, stay latched until the gesture ends. A gesture ends
 * when the stream goes quiet (`quietMs` without an event). Two cues end it
 * early, because a user re-swiping mid-momentum never pauses:
 * - a direction reversal — momentum never flips sign, so an opposite delta is
 *   deliberate input;
 * - a decay-then-rise: momentum decays monotonically (touching the trackpad
 *   cancels it outright), while a fresh drag ramps up from small deltas. Once
 *   the magnitude has fallen well below the gesture's peak ("armed"), two
 *   consecutive meaningful rises read as a new swipe. A steady continuous
 *   scroll never dips, never arms, and so still fires only once.
 * These are guesses reconstructed from timing and magnitudes, and uneven event
 * delivery can defeat them — which is exactly why platforms that can surface
 * the real phases use phase mode instead.
 *
 * Purely timestamp-driven (no timers): feed each event's delta with a time
 * reading and act on the returned direction. All feeds into one instance MUST
 * share a single monotonic clock. Raw `event.timeStamp` is NOT such a clock
 * when events come from more than one document — each document stamps against
 * its own time origin (a section iframe starts near zero), and an origin jump
 * mid-gesture reads as a quiet gap, unlatching against leftover momentum.
 * See `wheelEventTime` in FoliateReaderView for the normalization.
 */

export type WheelGestureStep = -1 | 0 | 1;

export type WheelGesture = {
  /** Feed one event's delta; returns the step to take now (0 = none). */
  feed: (delta: number, timeMs: number) => WheelGestureStep;
  /**
   * Record an event whose delta was spent elsewhere — a zoomed page panned
   * by it. The gesture counts as having fired that way: the rest of it can
   * no longer step, so a swipe that pans to a page's edge stops there, and
   * only a new gesture at the edge turns the page.
   */
  claim: (delta: number, timeMs: number) => void;
  /**
   * Whether this event is travel left over from a gesture that already
   * stepped — the rest of the drag, or its momentum. Asked before an event
   * is offered elsewhere: the swipe that turned a zoomed page must not go on
   * to pan the page it turned to, which opens where reading it begins. An
   * event it answers true for is accounted for and must not be fed as well;
   * one that starts a new gesture answers false and is fed or claimed as
   * usual.
   */
  trailing: (delta: number, timeMs: number) => boolean;
  /** Feed one host-reported gesture phase edge; switches the machine to
   *  phase mode permanently (the source, once present, keeps reporting). */
  notifyPhase: (edge: WheelPhaseEdge) => void;
  reset: () => void;
};

type WheelGestureOptions = {
  /** Accumulated travel (px) at which the gesture fires. */
  threshold: number;
  /** A pause in the stream longer than this ends the gesture. */
  quietMs?: number;
};

const DEFAULT_QUIET_MS = 250;
// Heuristic mode only — the decay-then-rise re-swipe detector. The rise
// detector arms once the magnitude falls to this fraction of the gesture's
// peak, i.e. once we're clearly into a decaying tail (or the tail was
// cancelled by a new touch, whose drag starts small).
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

export function createWheelGesture({ threshold, quietMs = DEFAULT_QUIET_MS }: WheelGestureOptions): WheelGesture {
  // What the wheel stream is currently doing, per the host's phase edges;
  // null until the first edge arrives = heuristic mode.
  let stream: "drag" | "momentum" | "idle" | null = null;
  let accum = 0;
  let firedDirection: WheelGestureStep = 0;
  // The latch came from a step fired here, rather than from a claim.
  let stepped = false;
  let lastEventAt = Number.NEGATIVE_INFINITY;
  // Latched-phase state for heuristic mode's decay-then-rise detector.
  let peak = 0;
  let armed = false;
  let risingStreak = 0;
  let lastMagnitude = 0;

  const reset = () => {
    accum = 0;
    firedDirection = 0;
    stepped = false;
    peak = 0;
    armed = false;
    risingStreak = 0;
    lastMagnitude = 0;
  };

  const notifyPhase = (edge: WheelPhaseEdge) => {
    if (edge === "touch") {
      // Fingers landed on the pad: whatever was accumulating or latched
      // belongs to a finished gesture. New contact, new gesture.
      reset();
      stream = "drag";
      return;
    }
    if (edge === "momentum") {
      stream = "momentum";
      return;
    }
    // "end" — the momentum tail finished. Free the latch so a phase-less
    // device used alongside the trackpad (a plugged-in mouse) never starts
    // against a stale latch.
    reset();
    stream = "idle";
  };

  /** Accumulate toward the threshold; a direction change starts the count
   *  over. Returns the fired step, without latching. */
  const accumulate = (delta: number, direction: WheelGestureStep): WheelGestureStep => {
    if (accum !== 0 && direction !== Math.sign(accum)) accum = 0;
    accum += delta;
    if (Math.abs(accum) < threshold) return 0;
    accum = 0;
    return direction;
  };

  const fire = (delta: number, direction: WheelGestureStep): WheelGestureStep => {
    const step = accumulate(delta, direction);
    if (step !== 0) {
      firedDirection = step;
      stepped = true;
    }
    return step;
  };

  /** Phase mode, latched: whether this event still belongs to the fired gesture. Frees the latch when it does not. */
  const latchedPhased = (direction: WheelGestureStep, magnitude: number): boolean => {
    // Coasting after release: once fired the gesture is spent — only a new
    // touch starts another.
    if (stream === "momentum") return true;
    // A reversal while latched is deliberate input — start over the other
    // way. Same-direction travel is this gesture's own surplus.
    if (direction === firedDirection || magnitude < REVERSE_MIN_DELTA) return true;
    reset();
    return false;
  };

  /** Heuristic mode, latched: the same question, answered from the stream's shape. */
  const latchedHeuristic = (direction: WheelGestureStep, magnitude: number): boolean => {
    const reversed = direction !== firedDirection && magnitude >= REVERSE_MIN_DELTA;
    peak = Math.max(peak, magnitude);
    if (magnitude <= peak * ARM_FRACTION) armed = true;
    risingStreak = armed && magnitude > lastMagnitude * RISE_FACTOR ? risingStreak + 1 : 0;
    const restarted = risingStreak >= RISE_STREAK_TO_RESTART && magnitude >= RESTART_MIN_DELTA;
    lastMagnitude = magnitude;
    if (!reversed && !restarted) return true;
    reset();
    return false;
  };

  const feedPhased = (delta: number, direction: WheelGestureStep, magnitude: number): WheelGestureStep => {
    // "idle": no trackpad gesture is active, so these deltas are mouse-wheel
    // notches (a trackpad always announces a touch first). Ratchet — every
    // `threshold` of travel steps once, no latch, deterministic under a held
    // scroll.
    if (stream === "idle") return accumulate(delta, direction);
    // A drag, or the momentum after it — which may still complete a light
    // swipe that hadn't reached the threshold.
    if (firedDirection !== 0 && latchedPhased(direction, magnitude)) return 0;
    return fire(delta, direction);
  };

  const feedHeuristic = (delta: number, direction: WheelGestureStep, magnitude: number): WheelGestureStep => {
    if (firedDirection !== 0 && latchedHeuristic(direction, magnitude)) return 0;
    const step = fire(delta, direction);
    if (step !== 0) {
      peak = magnitude;
      lastMagnitude = magnitude;
    }
    return step;
  };

  const observe = (timeMs: number) => {
    if (timeMs - lastEventAt > quietMs) {
      // A gap in the stream ends the gesture in every state that trusts
      // timing. Momentum is exempt: fingers are off the pad, only a real
      // phase edge may end that gesture — a busy webview stalls and clumps
      // the momentum tail, and reading such a stall as "gesture over" is
      // how phantom turns were born. In drag, the same reset lets a
      // deliberate drag-pause-drag (fingers resting on the pad, or a stale
      // "drag" left by a release without momentum) turn again.
      if (stream === "idle") accum = 0;
      else if (stream !== "momentum") reset();
    }
    lastEventAt = timeMs;
  };

  const feed = (delta: number, timeMs: number): WheelGestureStep => {
    observe(timeMs);
    const magnitude = Math.abs(delta);
    if (magnitude === 0) return 0;
    const direction: WheelGestureStep = delta > 0 ? 1 : -1;
    return stream === null ? feedHeuristic(delta, direction, magnitude) : feedPhased(delta, direction, magnitude);
  };

  const claim = (delta: number, timeMs: number) => {
    observe(timeMs);
    const magnitude = Math.abs(delta);
    if (magnitude === 0) return;
    // Latched as a fired gesture is. Heuristic mode tracks the claim's own
    // magnitude as the peak, so its re-swipe detector still sees a new
    // swipe once this one's tail has decayed.
    accum = 0;
    peak = firedDirection === 0 ? magnitude : Math.max(peak, magnitude);
    firedDirection = delta > 0 ? 1 : -1;
    stepped = false;
    lastMagnitude = magnitude;
    armed = false;
    risingStreak = 0;
  };

  const trailing = (delta: number, timeMs: number): boolean => {
    observe(timeMs);
    // Only a step latches with `stepped`; a mouse wheel's ratchet never does.
    if (!stepped) return false;
    const magnitude = Math.abs(delta);
    if (magnitude === 0) return true;
    const direction: WheelGestureStep = delta > 0 ? 1 : -1;
    return stream === null ? latchedHeuristic(direction, magnitude) : latchedPhased(direction, magnitude);
  };

  return { feed, claim, trailing, notifyPhase, reset };
}
