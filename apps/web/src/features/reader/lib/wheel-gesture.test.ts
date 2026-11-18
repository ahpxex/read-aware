import { describe, expect, test } from "bun:test";
import { createWheelGesture } from "./wheel-gesture";

// A gesture spent panning a zoomed page must never also turn it; a new
// gesture at the page's edge does.
describe("claimed gestures", () => {
  test("heuristic mode: travel after a claim never steps until the gesture ends", () => {
    const gesture = createWheelGesture({ threshold: 60 });
    let t = 0;
    for (let i = 0; i < 5; i++) gesture.claim(30, (t += 16));
    // The page reached its edge; the same swipe keeps pushing.
    for (let i = 0; i < 10; i++) expect(gesture.feed(30, (t += 16))).toBe(0);
    // A pause ends it; a new swipe at the edge turns.
    t += 400;
    expect(gesture.feed(30, (t += 16))).toBe(0);
    expect(gesture.feed(30, (t += 16))).toBe(1);
  });

  test("heuristic mode: a reversal after a claim is new input", () => {
    const gesture = createWheelGesture({ threshold: 60 });
    let t = 0;
    gesture.claim(40, (t += 16));
    expect(gesture.feed(-40, (t += 16))).toBe(0);
    expect(gesture.feed(-40, (t += 16))).toBe(-1);
  });

  test("phase mode: a claimed drag stays spent through its momentum; the next touch can step", () => {
    const gesture = createWheelGesture({ threshold: 60 });
    let t = 0;
    gesture.notifyPhase("touch");
    gesture.claim(50, (t += 16));
    expect(gesture.feed(80, (t += 16))).toBe(0);
    gesture.notifyPhase("momentum");
    for (let i = 0; i < 20; i++) expect(gesture.feed(40, (t += 16))).toBe(0);
    gesture.notifyPhase("end");
    gesture.notifyPhase("touch");
    expect(gesture.feed(70, (t += 16))).toBe(1);
  });

  test("an unclaimed gesture still steps once at the threshold", () => {
    const gesture = createWheelGesture({ threshold: 60 });
    expect(gesture.feed(30, 16)).toBe(0);
    expect(gesture.feed(30, 32)).toBe(1);
    expect(gesture.feed(30, 48)).toBe(0);
  });
});

// The swipe that turned a zoomed page must not go on to pan the page it
// turned to: its remaining travel is asked about before any pan is tried.
describe("travel left over from a step", () => {
  test("heuristic mode: the rest of the swipe trails; a pause, a reversal or a fresh swipe does not", () => {
    const gesture = createWheelGesture({ threshold: 60 });
    let t = 0;
    expect(gesture.trailing(40, (t += 16))).toBe(false);
    expect(gesture.feed(40, t)).toBe(0);
    expect(gesture.trailing(40, (t += 16))).toBe(false);
    expect(gesture.feed(40, t)).toBe(1);
    // The same swipe, decaying.
    for (const delta of [40, 30, 20, 12, 6]) expect(gesture.trailing(delta, (t += 16))).toBe(true);
    // A pause ends it.
    expect(gesture.trailing(30, (t += 400))).toBe(false);
    expect(gesture.feed(30, t)).toBe(0);
    expect(gesture.feed(30, (t += 16))).toBe(1);
    // A reversal is new input, and counts toward its own step.
    expect(gesture.trailing(-40, (t += 16))).toBe(false);
    expect(gesture.feed(-40, t)).toBe(0);
    expect(gesture.feed(-40, (t += 16))).toBe(-1);
    // A fresh swipe ramping up out of the decayed tail is new input too.
    for (const delta of [-30, -12, -5]) expect(gesture.trailing(delta, (t += 16))).toBe(true);
    expect(gesture.trailing(-14, (t += 16))).toBe(true);
    expect(gesture.trailing(-36, (t += 16))).toBe(false);
  });

  test("phase mode: trails through the drag and its momentum, until the next touch", () => {
    const gesture = createWheelGesture({ threshold: 60 });
    let t = 0;
    gesture.notifyPhase("touch");
    expect(gesture.feed(70, (t += 16))).toBe(1);
    expect(gesture.trailing(50, (t += 16))).toBe(true);
    gesture.notifyPhase("momentum");
    // A stall that clumps the momentum tail is still the same gesture.
    expect(gesture.trailing(40, (t += 600))).toBe(true);
    gesture.notifyPhase("end");
    gesture.notifyPhase("touch");
    expect(gesture.trailing(20, (t += 16))).toBe(false);
  });

  test("a gesture spent panning does not trail: it goes on panning", () => {
    const gesture = createWheelGesture({ threshold: 60 });
    let t = 0;
    gesture.claim(40, (t += 16));
    expect(gesture.trailing(40, (t += 16))).toBe(false);
    gesture.notifyPhase("touch");
    gesture.claim(40, (t += 16));
    expect(gesture.trailing(40, (t += 16))).toBe(false);
  });

  test("phase mode: a mouse wheel's notches never trail — each one acts on the page in front of it", () => {
    const gesture = createWheelGesture({ threshold: 60 });
    let t = 0;
    gesture.notifyPhase("touch");
    gesture.notifyPhase("end");
    expect(gesture.feed(100, (t += 16))).toBe(1);
    expect(gesture.trailing(100, (t += 120))).toBe(false);
  });

  test("heuristic mode: notches rolled straight on from a step trail until the wheel pauses", () => {
    // Without phases an even run of notches cannot be told from one swipe, so
    // it is held to the same rule as the roll that panned to a page's edge:
    // it stops there, and the wheel moves the page again after a pause.
    const gesture = createWheelGesture({ threshold: 60 });
    let t = 0;
    expect(gesture.feed(100, (t += 16))).toBe(1);
    for (let i = 0; i < 6; i++) expect(gesture.trailing(100, (t += 60))).toBe(true);
    expect(gesture.trailing(100, (t += 300))).toBe(false);
  });
});
