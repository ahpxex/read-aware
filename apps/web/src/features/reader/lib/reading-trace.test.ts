import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import type { ReadingSessionBucket, SessionPosition } from "../../../platform/reading-session";
import { bucketKeyAt } from "./reading-session-policy";
import { ReadingTraceCoordinator } from "./reading-trace";

const at = new Date(2026, 8, 10, 12, 1).getTime();
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
};

function fixture() {
  let pending: ReadingSessionBucket[] = [];
  const events: ReadingSessionBucket[] = [], errors: unknown[] = [];
  const bucket = (bookId: string, time: number) => {
    const key = bucketKeyAt(bookId, time);
    let value = pending.find(b => b.bookId === bookId && b.localDay === key.localDay && b.localHour === key.localHour);
    if (!value) { value = { ...key, ms: 0, startedAt: time, lastAt: time, progress: null, positionAt: null }; pending.push(value); }
    return value;
  };
  const store = {
    accrue: async (bookId: string, ms: number, time: number) => { bucket(bookId, time).ms += ms; },
    position: async (bookId: string, progress: SessionPosition, time: number) => {
      const b = bucket(bookId, time); b.progress = progress; b.positionAt = time;
    },
    pending: async () => structuredClone(pending),
    flush: async (buckets: ReadingSessionBucket[]) => {
      events.push(...structuredClone(buckets));
      pending = pending.filter(b => !buckets.some(c => c.bookId === b.bookId && c.localDay === b.localDay && c.localHour === b.localHour));
    },
    report: (error: unknown) => { errors.push(error); },
  };
  return { coordinator: new ReadingTraceCoordinator(store), store, events, errors };
}

test("retirement joins delayed time and position writes and rejects late callbacks", async () => {
  const f = fixture(), gate = deferred(), entered = deferred();
  const original = f.store.accrue;
  f.store.accrue = async (...args) => { entered.resolve(); await gate.promise; await original(...args); };
  const trace = f.coordinator.begin("session", "book");
  trace.accrue(2000, at);
  const position = { locator: "accepted" };
  trace.position(position, at); position.locator = "mutated";
  const unbind = trace.bindSampler(() => trace.accrue(1000, at));
  let done = false;
  const close = trace.retire().then(() => { done = true; });
  await entered.promise;
  expect(done).toBe(false); expect(trace.accepting).toBe(false);
  trace.accrue(999, at); trace.position({ locator: "late" }, at); unbind();
  gate.resolve(); await close;
  expect(f.events).toHaveLength(1);
  expect(f.events[0]).toMatchObject({ ms: 3000, progress: { locator: "accepted" } });
  expect(await f.store.pending()).toEqual([]);
  await trace.retire(); expect(f.events).toHaveLength(1);
});

test("view remount transfers sampling without closing the session", async () => {
  const f = fixture(), trace = f.coordinator.begin("s1", "book");
  const old = trace.bindSampler(() => trace.accrue(1000, at));
  old();
  expect(trace.accepting).toBe(true);
  trace.bindSampler(() => trace.accrue(2000, at));
  old();
  await trace.retire();
  expect(f.events).toHaveLength(1); expect(f.events[0].ms).toBe(3000);
});

test("rapid same-book replacement serializes old retirement before new writes", async () => {
  const f = fixture(), gate = deferred(), entered = deferred();
  const original = f.store.position;
  f.store.position = async (...args) => { entered.resolve(); await gate.promise; await original(...args); };
  const old = f.coordinator.begin("s1", "book"); old.position({ locator: "old" }, at);
  await entered.promise;
  const next = f.coordinator.begin("s2", "book"); next.position({ locator: "new" }, at);
  old.position({ locator: "late old" }, at);
  gate.resolve(); await next.retire();
  expect(f.events.map(b => b.progress?.locator)).toEqual(["old", "new"]);
  expect(await f.store.pending()).toEqual([]);
});

test("retirement and hour rollover flush only the owned book", async () => {
  const f = fixture(); await f.store.accrue("unrelated", 9000, at);
  const trace = f.coordinator.begin("s", "book");
  trace.accrue(1000, at); trace.position({ locator: "next hour" }, at + 3600000);
  await trace.retire();
  expect(f.events.map(b => b.bookId)).toEqual(["book", "book"]);
  expect((await f.store.pending()).map(b => b.bookId)).toEqual(["unrelated"]);
});

test("write failure cannot be hidden by successful final flush or poison the next session", async () => {
  const f = fixture(), error = new AppError("db/locked", "fixture");
  const original = f.store.accrue;
  f.store.accrue = async () => { throw error; };
  const trace = f.coordinator.begin("s1", "book"); trace.accrue(1000, at);
  await expect(trace.retire()).rejects.toBe(error);
  expect(f.errors).toContain(error);
  f.store.accrue = original;
  const next = f.coordinator.begin("s2", "other"); next.accrue(2000, at);
  await next.retire(); expect(f.events[0].ms).toBe(2000);
});

test("flush failure retains buckets and still banks new observations", async () => {
  const f = fixture(), error = new AppError("db/locked", "fixture");
  await f.store.accrue("book", 1000, at);
  f.store.flush = async () => { throw error; };
  const trace = f.coordinator.begin("s", "book"); trace.accrue(2000, at + 3600000);
  await expect(trace.retire()).rejects.toBe(error);
  expect((await f.store.pending()).map(b => b.ms)).toEqual([1000, 2000]);
  expect(f.errors).toContain(error);
});
