import { expect, test } from "bun:test";
import { AppError, normalizeAnnotationObservation, type AnnotationObservation, type AnnotationObservationQuery, type AnnotationObservationResult } from "@read-aware/core";
import { AnnotationObserver } from "./annotation-observer";

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const empty: AnnotationObservationResult = { kind: "page", page: { items: [], nextCursor: null, consistency: "live" } };
function fixture() {
  const timers = new Set<() => void>(), errors: unknown[] = [];
  const observer = new AnnotationObserver({ schedule: work => { timers.add(work); return () => { timers.delete(work); }; }, report: error => { errors.push(error); } });
  return { observer, timers, errors, async next() { const work = [...timers]; timers.clear(); for (const run of work) run(); await tick(); } };
}

test("annotation observations validate and freeze exact bounded queries", () => {
  for (const query of [null, [], {}, { kind: "list" }, { kind: "inspect", annotationId: "" }, { kind: "inspect", annotationId: "a", sql: true },
    { kind: "page", query: { limit: 101 } }, { kind: "page", query: { all: true } }, { kind: "page", query: null }]) {
    expect(() => normalizeAnnotationObservation(query as never)).toThrow();
  }
  expect(normalizeAnnotationObservation({ kind: "page" })).toMatchObject({ query: { limit: 20 } });
  expect(() => normalizeAnnotationObservation({ kind: "page", query: { cursor: "" } })).toThrow(expect.objectContaining({ code: "annotations/invalid-cursor" }));
});

test("initial, external write, error and recovery are distinct and unchanged snapshots are suppressed", async () => {
  const f = fixture(), seen: AnnotationObservation[] = []; let result = empty, failure: unknown;
  const stop = f.observer.observe({ kind: "page" }, async () => { if (failure) throw failure; return result; }, event => { seen.push(event); });
  await tick(); await f.next(); expect(seen).toHaveLength(1);
  result = { kind: "page", page: { ...empty.page, nextCursor: "changed-without-domain-broadcast" } };
  await f.next(); expect(seen).toHaveLength(2);
  failure = new AppError("db/locked", "PRIVATE"); await f.next(); await f.next();
  expect(seen.at(-1)).toEqual({ status: "error", errorCode: "db/locked", revision: 3 });
  failure = undefined; await f.next(); expect(seen.at(-1)).toMatchObject({ status: "ready", revision: 4 });
  expect(JSON.stringify(seen)).not.toContain("PRIVATE"); stop(); expect(f.timers.size).toBe(0);
});

test("queries/results cannot be mutated by callers and failed callbacks are retried", async () => {
  const f = fixture(), accepted: AnnotationObservationQuery[] = [], seen: AnnotationObservation[] = [];
  const query = { kind: "page" as const, query: { bookId: "b", limit: 2 } }; let fail = true;
  const stop = f.observer.observe(query, async q => { accepted.push(structuredClone(q)); if (q.kind === "page") q.query!.bookId = "bad"; return empty; }, event => {
    seen.push(structuredClone(event)); if (event.status === "ready" && event.result.kind === "page") event.result.page.nextCursor = "bad";
    if (fail) throw Error("callback failed");
  });
  query.query.bookId = "other"; await tick(); fail = false; await f.next(); await f.next();
  expect(accepted.every(q => q.kind === "page" && q.query?.bookId === "b")).toBe(true);
  expect(seen).toHaveLength(2); expect(seen[1]).toMatchObject({ revision: 2, result: empty }); expect(empty.page.nextCursor).toBeNull(); stop();
});

test("no overlapping reads/deliveries and disposal drops pending reads and render callbacks", async () => {
  const f = fixture(); let resolve!: (value: AnnotationObservationResult) => void, reads = 0, callbacks = 0;
  const life = new AbortController();
  f.observer.observe({ kind: "inspect", annotationId: "a" }, () => { reads++; return new Promise(r => { resolve = r; }); }, () => { callbacks++; }, life.signal);
  await tick(); expect(f.timers.size).toBe(0); expect(reads).toBe(1); life.abort(); resolve({ kind: "inspect", snapshot: null }); await tick();
  expect(callbacks).toBe(0); expect(f.timers.size).toBe(0);
  let release!: () => void;
  const stop = f.observer.observe({ kind: "page" }, async () => empty, () => new Promise<void>(r => { release = r; }));
  await tick(); expect(f.timers.size).toBe(0); stop(); release(); await tick(); expect(f.timers.size).toBe(0);
});

test("global subscription quota and retired owners reject before storage, disposal restores capacity", async () => {
  const f = fixture(); let reads = 0;
  const read = async () => { reads++; return empty; };
  const stops = Array.from({ length: 64 }, () => f.observer.observe({ kind: "page" }, read, () => {}));
  expect(() => f.observer.observe({ kind: "page" }, read, () => {})).toThrow(expect.objectContaining({ code: "annotations/observer-limit" }));
  expect(() => f.observer.observe({ kind: "page" }, read, () => {}, AbortSignal.abort())).toThrow(expect.objectContaining({ code: "annotations/cancelled" }));
  expect(reads).toBe(64); stops[0]!(); stops[0]!(); stops.push(f.observer.observe({ kind: "page" }, read, () => {}));
  for (const stop of stops) stop(); await tick(); expect(f.timers.size).toBe(0);
});
