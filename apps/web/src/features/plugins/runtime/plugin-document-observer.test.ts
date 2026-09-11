import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import type { PluginDocumentObservation, PluginDocumentObservationResult } from "@read-aware/plugin-types";
import { PluginLifecycleController } from "./plugin-lifecycle";
import { PluginDocumentObserver } from "./plugin-document-observer";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture() {
  const lifecycle = new PluginLifecycleController([]), timers = new Set<() => void>(), errors: unknown[] = [];
  const observer = new PluginDocumentObserver(lifecycle, { schedule(work) { timers.add(work); return () => { timers.delete(work); }; }, report(error) { errors.push(error); } });
  const next = async () => { const jobs = [...timers]; timers.clear(); for (const job of jobs) job(); await tick(); };
  return { lifecycle, observer, timers, errors, next };
}

test("document observations stage, deduplicate, report stable failures and recover", async () => {
  const f = fixture(), events: PluginDocumentObservation[] = [];
  let reads = 0, fail = false;
  let result: PluginDocumentObservationResult = { kind: "get", document: null };
  const subscription = f.observer.observe(async () => { reads++; if (fail) throw new AppError("db/locked", "private cause"); return result; }, event => { events.push(event); });
  expect(reads).toBe(0); f.lifecycle.promote(); await tick();
  expect(events).toEqual([{ sequence: 1, status: "ready", result }]);
  await f.next(); expect(events).toHaveLength(1);
  result = { kind: "get", document: { id: "one", data: { value: 1 }, revision: "a".repeat(32), updatedAt: "now" } };
  await f.next(); expect(events).toHaveLength(2);
  fail = true; await f.next(); await f.next();
  expect(events.at(-1)).toEqual({ sequence: 3, status: "error", errorCode: "db/locked" });
  fail = false; await f.next(); expect(events.at(-1)).toMatchObject({ sequence: 4, status: "ready" });
  subscription.dispose(); expect(f.timers.size).toBe(0); f.lifecycle.stop();
});

test("callbacks are serial, mutation is isolated, failed delivery retries and retirement drops late reads", async () => {
  const f = fixture(); f.lifecycle.promote();
  const original = { kind: "get", document: null } as const;
  let release!: () => void, calls = 0;
  const subscription = f.observer.observe(async () => original, async event => {
    calls++; event.sequence = 999;
    await new Promise<void>(resolve => { release = resolve; });
    if (calls === 1) throw Error("callback failed");
  });
  await tick(); expect(f.timers.size).toBe(0); release(); await tick();
  await f.next(); expect(calls).toBe(2); release(); await tick();
  await f.next(); expect(calls).toBe(2); subscription.dispose();
  let finish!: (result: PluginDocumentObservationResult) => void;
  f.observer.observe<unknown>(() => new Promise(resolve => { finish = resolve; }), () => { calls++; });
  f.lifecycle.stop(); finish(original); await tick();
  expect(calls).toBe(2); expect(f.timers.size).toBe(0);
});

test("observer quotas span collections and subscriptions cannot run during migration", async () => {
  const f = fixture(); f.lifecycle.beginMigration();
  expect(() => f.observer.observe(async () => ({ kind: "get", document: null }), () => {})).toThrow("migration");
  f.lifecycle.finishMigration(); f.lifecycle.promote();
  const subscriptions = Array.from({ length: 64 }, () => f.observer.observe(async () => ({ kind: "page", page: { status: "stale-cursor" } }), () => {}));
  expect(() => f.observer.observe(async () => ({ kind: "get", document: null }), () => {})).toThrow("Too many");
  subscriptions[0]!.dispose();
  expect(() => f.observer.observe(async () => ({ kind: "get", document: null }), () => {})).not.toThrow();
  f.lifecycle.stop(); await tick(); expect(f.timers.size).toBe(0);
});
