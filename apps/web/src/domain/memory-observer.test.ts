import { expect, test } from "bun:test";
import { AppError, type MemoryObservation, type MemoryObservationQuery, type MemoryObservationResult } from "@read-aware/core";
import { MemoryObserver, normalizeMemoryObservation } from "./memory-observer";

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const ready = (): MemoryObservationResult => ({ kind: "inspect", snapshot: null });
const query: MemoryObservationQuery = { kind: "inspect", memoryId: "m" };
function fixture() {
  const timers = new Set<() => void>(), errors: unknown[] = [];
  const observer = new MemoryObserver({ schedule: work => { timers.add(work); return () => { timers.delete(work); }; }, report: error => { errors.push(error); } });
  return { observer, timers, errors, tick: async () => { const work = [...timers]; timers.clear(); work.forEach(fn => fn()); await flush(); } };
}
test("observation validates and copies only supported bounded query authority", () => {
  expect(normalizeMemoryObservation({ kind: "profile" })).toEqual({ kind: "profile", query: { offset: 0, limit: 4000 } });
  expect(() => normalizeMemoryObservation({ kind: "profile", query: { offset: 2 } })).toThrow();
  expect(() => normalizeMemoryObservation({ kind: "profile", bookId: "b" } as never)).toThrow();
  expect(normalizeMemoryObservation({ kind: "classification", bookId: "b" })).toEqual({ kind: "classification", bookId: "b" });
  expect(normalizeMemoryObservation({ kind: "search", query: { scopes: ["user", "user"], query: " x " } })).toEqual({ kind: "search", query: { scopes: ["user"], query: "x", limit: 20 } });
  for (const input of [null, [], {}, { kind: "inspect", memoryId: " " }, { kind: "inspect", memoryId: "m", raw: true },
    { kind: "search", query: { scopes: ["all"] } }, { kind: "bookGraph", bookId: "b", query: { confirmSpoiler: true } },
    { kind: "bookGraph", bookId: "b", query: { names: ["Ada"], chapterIndex: 1 } }, { kind: "bookGraph", bookId: "" },
    { kind: "bookGraph", bookId: "b", query: null }, { kind: "classification", bookId: "b", query: {} }, { kind: "classification", bookId: " " }]) {
    expect(() => normalizeMemoryObservation(input as never)).toThrow();
  }
});
test("initial snapshot, changed results, stable errors and recovery are ordered without raw text", async () => {
  const f = fixture(), events: MemoryObservation[] = [];
  let fail = false, value = ready();
  const stop = f.observer.observe(query, async () => { if (fail) throw new AppError("db/locked", "PRIVATE"); return value; }, event => { events.push(event); });
  await flush(); await f.tick(); expect(events).toHaveLength(1);
  fail = true; await f.tick(); await f.tick();
  expect(events.at(-1)).toEqual({ status: "error", errorCode: "db/locked", revision: 2 }); expect(events).toHaveLength(2);
  fail = false; await f.tick(); expect(events.at(-1)).toEqual({ status: "ready", result: ready(), revision: 3 });
  value = { kind: "bookGraph", graph: { graph: "miss", note: "Fence contracted" } }; await f.tick();
  expect(events.at(-1)?.revision).toBe(4); expect(JSON.stringify(events)).not.toContain("PRIVATE");
  stop(); expect(f.timers.size).toBe(0);
});
test("slow reads and consumers never overlap; failed callbacks retry the same result", async () => {
  const f = fixture(); let finishRead!: (value: MemoryObservationResult) => void, finishHandler!: () => void, calls = 0, reads = 0;
  const stop = f.observer.observe(query, async () => { reads++; return new Promise(resolve => { finishRead = resolve; }); }, async () => {
    calls++; if (calls === 1) return new Promise<void>(resolve => { finishHandler = resolve; });
    if (calls === 2) throw Error("Consumer failure");
  });
  await flush(); expect(f.timers.size).toBe(0); expect(reads).toBe(1);
  finishRead(ready()); await flush(); expect(calls).toBe(1); expect(f.timers.size).toBe(0);
  finishHandler(); await flush(); expect(f.timers.size).toBe(1);
  await f.tick(); finishRead({ kind: "search", memories: [] }); await flush(); expect(calls).toBe(2);
  await f.tick(); finishRead({ kind: "search", memories: [] }); await flush(); expect(calls).toBe(3); expect(f.errors).toHaveLength(1);
  stop();
});
test("caller, query reader and callback mutation do not change the accepted request", async () => {
  const f = fixture(), observed: string[][] = [], input: MemoryObservationQuery = { kind: "search", query: { scopes: ["user"] } };
  const stop = f.observer.observe(input, async next => {
    if (next.kind !== "search") throw Error("Wrong query");
    observed.push([...next.query.scopes]); next.query.scopes[0] = "global"; return { kind: "search", memories: [] };
  }, event => { if (event.status === "ready" && event.result.kind === "search") event.result.memories.push({} as never); });
  input.query.scopes[0] = "global"; await flush(); await f.tick();
  expect(observed).toEqual([["user"], ["user"]]); stop();
});
test("retirement discards pending reads and releases the global subscription budget", async () => {
  const f = fixture(), controller = new AbortController(); let resolve!: (value: MemoryObservationResult) => void, calls = 0;
  const stop = f.observer.observe(query, () => new Promise(done => { resolve = done; }), () => { calls++; }, controller.signal);
  controller.abort(); resolve(ready()); await flush(); stop();
  expect(calls).toBe(0); expect(f.timers.size).toBe(0);
  expect(() => f.observer.observe(query, async () => ready(), () => {}, controller.signal)).toThrow();
  const stops = Array.from({ length: 64 }, () => f.observer.observe(query, async () => ready(), () => {}));
  expect(() => f.observer.observe(query, async () => ready(), () => {})).toThrow("Too many memory observers");
  stops[0]!(); const replacement = f.observer.observe(query, async () => ready(), () => {}); replacement();
  stops.forEach(dispose => dispose()); await flush(); expect(f.timers.size).toBe(0);
});
