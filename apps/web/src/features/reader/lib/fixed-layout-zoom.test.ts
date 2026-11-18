import { describe, expect, test } from "bun:test";
import { lockedAxisOfPage } from "../../../../foliate-js/src/fixed-zoom";
import { ZOOM_FACTOR_MAX, ZOOM_FACTOR_MIN, stepZoomFactor, wheelPansView, wheelZoomRatio } from "./fixed-layout-zoom";

describe("zoom steps", () => {
  test("step along the ladder, and from between steps to the nearest one that way", () => {
    expect(stepZoomFactor(1, 1)).toBe(1.1);
    expect(stepZoomFactor(1, -1)).toBe(0.9);
    expect(stepZoomFactor(1.3, 1)).toBe(1.5);
    expect(stepZoomFactor(1.3, -1)).toBe(1.25);
    // A hair off a step counts as on it.
    expect(stepZoomFactor(1.249, 1)).toBe(1.5);
  });

  test("stop at the ends of the range", () => {
    expect(stepZoomFactor(ZOOM_FACTOR_MAX, 1)).toBe(ZOOM_FACTOR_MAX);
    expect(stepZoomFactor(ZOOM_FACTOR_MIN, -1)).toBe(ZOOM_FACTOR_MIN);
  });
});

describe("ctrl+wheel", () => {
  test("inverts Chromium's pinch deltas exactly", () => {
    // Chromium reports a pinch to scale s as deltaY = -100·ln(s).
    expect(wheelZoomRatio(-100 * Math.log(1.1), 0)).toBeCloseTo(1.1, 10);
    expect(wheelZoomRatio(-100 * Math.log(0.9), 0)).toBeCloseTo(0.9, 10);
  });

  test("turns a mouse-wheel notch into one bounded step, either way", () => {
    const zoomIn = wheelZoomRatio(-100, 0);
    const zoomOut = wheelZoomRatio(100, 0);
    expect(zoomIn).toBeGreaterThan(1.1);
    expect(zoomIn).toBeLessThan(1.3);
    expect(zoomIn * zoomOut).toBeCloseTo(1, 10);
    // Line- and page-mode deltas are converted before the same cap.
    expect(wheelZoomRatio(-3, 1)).toBe(zoomIn);
  });
});

describe("a locked view", () => {
  test("holds the axis across the page: a page is read along its long side", () => {
    expect(lockedAxisOfPage(600, 800)).toBe("x");
    expect(lockedAxisOfPage(800, 600)).toBe("y");
    // A square page reads downwards.
    expect(lockedAxisOfPage(700, 700)).toBe("x");
  });

  test("is panned by the wheel along the page only", () => {
    // Unlocked: any wheel event pans.
    expect(wheelPansView(40, 2, null)).toBe(true);
    expect(wheelPansView(2, 40, null)).toBe(true);
    // Locked across a portrait page: scrolling down it pans, a sideways swipe
    // — whatever it drifts vertically — is a page turn.
    expect(wheelPansView(3, 40, "x")).toBe(true);
    expect(wheelPansView(40, 3, "x")).toBe(false);
    // And the other way about on a landscape page.
    expect(wheelPansView(40, 3, "y")).toBe(true);
    expect(wheelPansView(3, 40, "y")).toBe(false);
  });
});
