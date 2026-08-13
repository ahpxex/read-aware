import { describe, expect, test } from "bun:test";
import type { BookProgress } from "../../library/lib/library-types";
import { createProgressThrottle } from "./progress-throttle";

/** Manual clock + task queue, so the policy is driven by hand. */
function makeClock() {
  let time = 0;
  const tasks = new Map<number, { fn: () => void; at: number }>();
  let nextId = 1;
  return {
    now: () => time,
    scheduler: {
      schedule(fn: () => void, ms: number) {
        const id = nextId;
        nextId += 1;
        tasks.set(id, { fn, at: time + ms });
        return id;
      },
      cancel(id: number) {
        tasks.delete(id);
      },
    },
    advance(ms: number) {
      time += ms;
      for (const [id, task] of [...tasks]) {
        if (task.at <= time) {
          tasks.delete(id);
          task.fn();
        }
      }
    },
  };
}

const at = (href: string, percent: number): BookProgress =>
  ({ href, cfi: `cfi-${percent}`, progressPercent: percent }) as unknown as BookProgress;

function setup() {
  const clock = makeClock();
  const commits: Array<{ bookId: string; progress: BookProgress }> = [];
  const throttle = createProgressThrottle(
    (bookId, progress) => commits.push({ bookId, progress }),
    { now: clock.now, scheduler: clock.scheduler },
  );
  return { clock, commits, throttle };
}

describe("progress commit throttle", () => {
  test("the first position and chapter changes commit promptly", () => {
    const { clock, commits, throttle } = setup();
    throttle.queue("b1", at("ch1", 1));
    clock.advance(250);
    expect(commits.length).toBe(1);

    // Same chapter: page flips coalesce...
    throttle.queue("b1", at("ch1", 2));
    clock.advance(250);
    expect(commits.length).toBe(1);
    // ...but a chapter boundary is a waypoint.
    throttle.queue("b1", at("ch2", 10));
    clock.advance(250);
    expect(commits.length).toBe(2);
    expect((commits[1].progress as { href: string }).href).toBe("ch2");
  });

  test("intra-chapter reading coalesces to one commit per interval, latest wins", () => {
    const { clock, commits, throttle } = setup();
    throttle.queue("b1", at("ch1", 1));
    clock.advance(250);
    expect(commits.length).toBe(1);

    // 40 page turns over ~29.75s: not one extra event...
    for (let i = 0; i < 40; i += 1) {
      throttle.queue("b1", at("ch1", 2 + i));
      clock.advance(700);
    }
    const midCommits = commits.length;
    expect(midCommits).toBeLessThanOrEqual(2);
    // ...and when the interval elapses, the LATEST position is what lands.
    clock.advance(31_000);
    const last = commits[commits.length - 1].progress as { progressPercent: number };
    expect(last.progressPercent).toBe(41);
  });

  test("flushAll commits pending positions immediately (closing the book)", () => {
    const { clock, commits, throttle } = setup();
    throttle.queue("b1", at("ch1", 1));
    clock.advance(250);
    throttle.queue("b1", at("ch1", 55));
    // No time passes — the reader unmounts with a pending position.
    throttle.flushAll();
    expect(commits.length).toBe(2);
    expect((commits[1].progress as { progressPercent: number }).progressPercent).toBe(55);
    // Nothing left behind to double-fire.
    clock.advance(60_000);
    expect(commits.length).toBe(2);
  });

  test("books throttle independently", () => {
    const { clock, commits, throttle } = setup();
    throttle.queue("b1", at("ch1", 1));
    throttle.queue("b2", at("intro", 1));
    clock.advance(250);
    expect(commits.map((c) => c.bookId).sort()).toEqual(["b1", "b2"]);
  });
});
