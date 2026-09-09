import { expect, test } from "bun:test";
import { AppError, normalizeReadingTimeQuery, type ReadingTimeSnapshot, type ReadingTimeObservation } from "@read-aware/core";
import { ReadingTimeObserver } from "./reading-time-observer";

const snapshot: ReadingTimeSnapshot = { bookId: "b", localDay: null, observedAtEpochMs: 123,
  settledMs: 1000, pendingMs: 2000, totalMs: 3000, pendingBucketCount: 1,
  pending: [{ bookId: "b", localDay: "2026-09-09", localHour: 10, ms: 2000, startedAt: 1, lastAt: 3, positionAt: 2 }], nextCursor: null };
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test("query validates date, exact scope, finite limits and copies cursor", () => {
  expect(normalizeReadingTimeQuery()).toEqual({ limit: 50 });
  for (const input of [null, [], { limit: 0 }, { limit: 101 }, { limit: NaN }, { bookId: " " }, { localDay: "2026-02-30" },
    { after: { bookId: "b", localDay: "2026-01-01", localHour: 24 } },
    { bookId: "a", after: { bookId: "b", localDay: "2026-01-01", localHour: 1 } }]) {
    expect(() => normalizeReadingTimeQuery(input as never)).toThrow();
  }
  const query = { bookId: "b", localDay: "2024-02-29", after: { bookId: "b", localDay: "2024-02-29", localHour: 1 } };
  const accepted = normalizeReadingTimeQuery(query); query.after.localHour = 2;
  expect(accepted.after?.localHour).toBe(1);
});

test("observer waits for slow consumers, reports read errors explicitly, and stops on dispose", async () => {
  let scheduled: (() => void) | undefined, resolveRead: (value: ReadingTimeSnapshot) => void = () => {}, calls = 0;
  let finish: () => void = () => {};
  const events: ReadingTimeObservation[] = [], errors: unknown[] = [];
  const observer = new ReadingTimeObserver({ read: async () => {
    if (++calls === 2) throw new AppError("db/locked", "private details");
    return new Promise(resolve => { resolveRead = resolve; });
  }, schedule: callback => { scheduled = () => { scheduled = undefined; callback(); }; return () => { scheduled = undefined; }; }, report: error => errors.push(error) });
  const dispose = observer.observe({}, async event => { events.push(event); if (event.revision === 1) await new Promise<void>(resolve => { finish = resolve; }); });
  expect(calls).toBe(1); resolveRead(snapshot); await tick(); expect(scheduled).toBeUndefined();
  finish(); await tick(); expect(scheduled).toBeFunction(); scheduled!(); await tick();
  expect(events[1]).toEqual({ revision: 2, status: "error", errorCode: "db/locked" });
  expect(JSON.stringify(events)).not.toContain("private details"); expect(errors).toHaveLength(1);
  scheduled!(); await tick(); dispose(); dispose(); resolveRead(snapshot); await tick();
  expect(events).toHaveLength(2); expect(scheduled).toBeUndefined();
});

test("observer quota is released immediately even with native reads still pending", async () => {
  const observer = new ReadingTimeObserver({ read: () => new Promise(() => {}), schedule: () => () => {}, report: () => {} });
  const disposables = Array.from({ length: 64 }, () => observer.observe({}, () => {}));
  expect(() => observer.observe({}, () => {})).toThrow();
  disposables.forEach(dispose => dispose());
  observer.observe({}, () => {})();
});
