/**
 * Hybrid logical clock.
 *
 * Every event carries one of these stamps, and the log is ordered by them — so
 * a duplicate stamp is not a cosmetic problem: `domain_events` has a UNIQUE
 * index on (wall, counter, device), and two events colliding means the second
 * is silently dropped on insert.
 *
 * Two things can produce a collision, and the clock defends against both:
 *   - **A wall clock going backwards** (NTP correction, a timezone-confused VM,
 *     the user setting the date). Time never moves backwards here; a lower
 *     reading just advances the counter instead.
 *   - **A restart.** The counter starts at zero in memory, so after a crash the
 *     next session could re-mint stamps this device already persisted. It
 *     reseeds past the highest stored stamp at boot (`seed`).
 *
 * Pure and dependency-free so it can be tested directly, which is the point:
 * this is the kind of logic that looks obviously correct and is not.
 */
import type { HlcStamp } from "@read-aware/core";

export type HlcClock = {
  /**
   * Move past everything already persisted. Called at boot with the highest
   * stamp this device wrote; safe to call more than once.
   */
  seed(wallMs: number | null | undefined, counter: number | null | undefined): void;
  /** The next stamp, strictly greater than every stamp handed out before it. */
  next(deviceId: string): HlcStamp;
};

export function createHlcClock(now: () => number = Date.now): HlcClock {
  let wallMs = 0;
  let counter = 0;

  return {
    seed(seedWall, seedCounter) {
      // Stores the highest counter already USED; `next` is what increments.
      const wall = seedWall ?? 0;
      if (wall > wallMs) {
        wallMs = wall;
        counter = seedCounter ?? -1;
      } else if (wall === wallMs) {
        counter = Math.max(counter, seedCounter ?? -1);
      }
    },
    next(deviceId) {
      const reading = now();
      if (reading > wallMs) {
        wallMs = reading;
        counter = 0;
      } else {
        // Same millisecond, or the clock stepped backwards: keep the logical
        // time monotonic and disambiguate with the counter.
        counter += 1;
      }
      return { wallMs, counter, deviceId };
    },
  };
}
