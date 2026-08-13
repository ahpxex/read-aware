import { describe, expect, test } from "bun:test";
import { createHlcClock } from "./hlc";

/** A wall clock the test drives by hand. */
function fakeNow(readings: number[]) {
  let index = 0;
  return () => readings[Math.min(index++, readings.length - 1)];
}

describe("hybrid logical clock", () => {
  test("advances with the wall clock and resets the counter", () => {
    const clock = createHlcClock(fakeNow([1_000, 1_001, 1_002]));
    expect(clock.next("d")).toEqual({ wallMs: 1_000, counter: 0, deviceId: "d" });
    expect(clock.next("d")).toEqual({ wallMs: 1_001, counter: 0, deviceId: "d" });
    expect(clock.next("d")).toEqual({ wallMs: 1_002, counter: 0, deviceId: "d" });
  });

  test("disambiguates stamps minted within one millisecond", () => {
    const clock = createHlcClock(fakeNow([1_000, 1_000, 1_000]));
    const stamps = [clock.next("d"), clock.next("d"), clock.next("d")];
    expect(stamps.map((s) => s.counter)).toEqual([0, 1, 2]);
    expect(new Set(stamps.map((s) => `${s.wallMs}:${s.counter}`)).size).toBe(3);
  });

  test("a wall clock stepping BACKWARDS never re-mints a stamp", () => {
    // NTP correction / the user changing the date mid-session.
    const clock = createHlcClock(fakeNow([5_000, 4_000, 4_500, 5_000]));
    const stamps = [clock.next("d"), clock.next("d"), clock.next("d"), clock.next("d")];
    const keys = stamps.map((s) => `${s.wallMs}:${s.counter}`);
    expect(new Set(keys).size).toBe(4);
    // Logical time is monotonic even while the wall reading regresses.
    for (let i = 1; i < stamps.length; i += 1) {
      const before = stamps[i - 1];
      const after = stamps[i];
      expect(
        after.wallMs > before.wallMs ||
          (after.wallMs === before.wallMs && after.counter > before.counter),
      ).toBe(true);
    }
  });

  test("reseeding past persisted stamps survives a restart in the same millisecond", () => {
    // The session that crashed had already written (1000, 4).
    const clock = createHlcClock(fakeNow([1_000, 1_000]));
    clock.seed(1_000, 4);
    expect(clock.next("d")).toEqual({ wallMs: 1_000, counter: 5, deviceId: "d" });
    expect(clock.next("d")).toEqual({ wallMs: 1_000, counter: 6, deviceId: "d" });
  });

  test("reseeding from the future keeps later stamps ahead of the log", () => {
    // Restored a backup written on a device whose clock ran ahead.
    const clock = createHlcClock(fakeNow([1_000]));
    clock.seed(9_000, 2);
    const stamp = clock.next("d");
    expect(stamp.wallMs).toBe(9_000);
    expect(stamp.counter).toBeGreaterThan(2);
  });

  test("seeding is idempotent and never rewinds", () => {
    const clock = createHlcClock(fakeNow([1_000]));
    clock.seed(5_000, 3);
    clock.seed(2_000, 99);
    clock.seed(null, null);
    const stamp = clock.next("d");
    expect(stamp.wallMs).toBe(5_000);
    expect(stamp.counter).toBeGreaterThan(3);
  });

  test("observing a stamp from a device with a faster clock keeps local writes after it", () => {
    // This device's wall clock lags the peer by four seconds. Without observe,
    // the next local stamp would be (1000, 0) — sorting BEFORE the merged
    // event and putting a later write in the causal past.
    const clock = createHlcClock(fakeNow([1_000, 1_001]));
    clock.observe({ wallMs: 5_000, counter: 2, deviceId: "peer" });
    const first = clock.next("d");
    expect(first.wallMs).toBe(5_000);
    expect(first.counter).toBeGreaterThan(2);
    const second = clock.next("d");
    expect(
      second.wallMs > first.wallMs ||
        (second.wallMs === first.wallMs && second.counter > first.counter),
    ).toBe(true);
  });

  test("observing an older stamp is a no-op", () => {
    const clock = createHlcClock(fakeNow([9_000]));
    clock.observe({ wallMs: 1_000, counter: 50, deviceId: "peer" });
    expect(clock.next("d")).toEqual({ wallMs: 9_000, counter: 0, deviceId: "d" });
  });

  test("interleaved observe and next stays monotonic through a merge burst", () => {
    // A pull delivers a batch of remote stamps while the local session writes.
    const clock = createHlcClock(fakeNow([2_000, 2_000, 2_000, 2_000]));
    const order: Array<{ wallMs: number; counter: number }> = [];
    order.push(clock.next("d"));
    clock.observe({ wallMs: 2_000, counter: 7, deviceId: "peer" });
    order.push(clock.next("d"));
    clock.observe({ wallMs: 1_500, counter: 99, deviceId: "peer" });
    order.push(clock.next("d"));
    for (let i = 1; i < order.length; i += 1) {
      const before = order[i - 1];
      const after = order[i];
      expect(
        after.wallMs > before.wallMs ||
          (after.wallMs === before.wallMs && after.counter > before.counter),
      ).toBe(true);
    }
    // The merged (2000, 7) sits between the first and second local stamps.
    expect(order[1].counter).toBeGreaterThan(7);
  });
});
