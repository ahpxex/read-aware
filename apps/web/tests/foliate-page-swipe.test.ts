import { describe, expect, test } from "bun:test";
import {
  discreteSwipeStep,
  SWIPE_DISCRETE_MIN_TRAVEL,
  swipePageStep,
  swipeReleaseVelocity,
  type SwipeSample,
} from "../foliate-js/src/page-swipe.js";

const PAGE = 400;
const FRAME_MS = 8; // a 120 Hz touch screen

/** Samples of a drag covering `distance` over `duration` ms, one per frame, then
 * held still for `hold` ms before the lift (which repeats the last position). */
const drag = (distance: number, duration: number, shape: "linear" | "ease-out", hold = 0): SwipeSample[] => {
  const samples: SwipeSample[] = [{ t: 0, travel: 0 }];
  for (let t = FRAME_MS; t <= duration; t += FRAME_MS) {
    const p = t / duration;
    samples.push({ t, travel: distance * (shape === "linear" ? p : 1 - (1 - p) ** 3) });
  }
  const last = samples.at(-1) ?? { t: 0, travel: 0 };
  samples.push({ t: last.t + hold + FRAME_MS, travel: last.travel });
  return samples;
};

describe("page swipe settling", () => {
  // Each of these stayed on the page under the last-sample velocity
  // (measured on an Android emulator at 120 Hz).
  test("turns on a short flick that eases off before the finger lifts", () => {
    expect(swipePageStep(drag(60, 100, "ease-out"), PAGE)).toBe(1);
    expect(swipePageStep(drag(100, 150, "ease-out"), PAGE)).toBe(1);
  });

  test("turns on a short constant-speed swipe", () => {
    expect(swipePageStep(drag(60, 100, "linear"), PAGE)).toBe(1);
  });

  test("turns backward symmetrically", () => {
    expect(swipePageStep(drag(-60, 100, "ease-out"), PAGE)).toBe(-1);
  });

  test("a slow drag turns once it covers a quarter of the page, and not before", () => {
    expect(swipePageStep(drag(90, 900, "linear", 150), PAGE)).toBe(0);
    expect(swipePageStep(drag(110, 900, "linear", 150), PAGE)).toBe(1);
  });

  test("a finger that stops before lifting is not a flick", () => {
    const samples = drag(60, 80, "linear", 200);
    expect(swipeReleaseVelocity(samples)).toBe(0);
    expect(swipePageStep(samples, PAGE)).toBe(0);
  });

  test("a fast jitter too short to be a swipe stays on the page", () => {
    expect(swipePageStep(drag(10, 16, "linear"), PAGE)).toBe(0);
  });

  test("flicking back against the drag cancels the turn", () => {
    const forward = drag(80, 200, "linear", 40);
    const end = forward.at(-1) ?? { t: 0, travel: 0 };
    const back = [1, 2, 3, 4, 5].map((i) => ({ t: end.t + i * FRAME_MS, travel: end.travel - i * 8 }));
    expect(swipePageStep([...forward, ...back], PAGE)).toBe(0);
  });

  test("a hard flick still moves exactly one page", () => {
    expect(swipePageStep(drag(300, 80, "linear"), PAGE)).toBe(1);
  });

  test("a tap without travel stays on the page", () => {
    expect(swipePageStep([{ t: 0, travel: 0 }], PAGE)).toBe(0);
    expect(swipePageStep([], PAGE)).toBe(0);
  });
});

describe("discrete swipe (e-ink)", () => {
  test("a slow, short drag that would snap back still turns: the reader never saw it move", () => {
    const slow = drag(SWIPE_DISCRETE_MIN_TRAVEL + 2, 900, "linear", 200);
    expect(swipePageStep(slow, PAGE)).toBe(0);
    expect(discreteSwipeStep(slow)).toBe(1);
    expect(discreteSwipeStep(drag(-(SWIPE_DISCRETE_MIN_TRAVEL + 2), 900, "linear"))).toBe(-1);
  });

  test("travel just short of deliberate, or none at all, turns nothing", () => {
    expect(discreteSwipeStep(drag(SWIPE_DISCRETE_MIN_TRAVEL - 1, 60, "linear"))).toBe(0);
    expect(discreteSwipeStep([{ t: 0, travel: 0 }])).toBe(0);
    expect(discreteSwipeStep([])).toBe(0);
  });

  test("the net travel decides, not the release direction", () => {
    const forward = drag(200, 200, "linear");
    const end = forward.at(-1) ?? { t: 0, travel: 0 };
    const flickBack = [1, 2, 3].map((i) => ({ t: end.t + i * FRAME_MS, travel: end.travel - i * 10 }));
    expect(discreteSwipeStep([...forward, ...flickBack])).toBe(1);
  });
});
