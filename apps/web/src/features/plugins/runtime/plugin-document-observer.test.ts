import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import type { PluginDocumentObservation, PluginDocumentObservationResult } from "@read-aware/plugin-types";
import { PluginLifecycleController } from "./plugin-lifecycle";
import { PluginDocumentObserver } from "./plugin-document-observer";
import { eventCause, reactionActor, stampEventCause } from "../../../platform/domain-actor";
import { emitAppEvent } from "../../../platform/app-events";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Another process, a sync pull or a restore changed the store. */
const invalidate = () => emitAppEvent("projections-invalidated", { source: "host" });
let fixtures = 0;
const reaction = (step: string) => reactionActor("plugin:docs", step, eventCause(stampEventCause({}))!);
function fixture() {
  const lifecycle = new PluginLifecycleController([]),
    timers = new Set<() => void>(),
    errors: unknown[] = [];
  const observer = new PluginDocumentObserver(`docs-${++fixtures}`, lifecycle, {
    schedule(work) {
      timers.add(work);
      return () => {
        timers.delete(work);
      };
    },
    report(error) {
      errors.push(error);
    },
  });
  const next = async () => {
    const jobs = [...timers];
    timers.clear();
    for (const job of jobs) job();
    await tick();
  };
  return { lifecycle, observer, timers, errors, next };
}

test("document observations stage, re-read only on announced changes, report stable failures and recover", async () => {
  const f = fixture(),
    events: PluginDocumentObservation[] = [];
  let reads = 0,
    fail = false;
  let result: PluginDocumentObservationResult = { kind: "get", document: null };
  const subscription = f.observer.observe(
    async () => {
      reads++;
      if (fail) throw new AppError("db/locked", "private cause");
      return result;
    },
    (event) => {
      events.push(event);
    },
  );
  expect(reads).toBe(0);
  f.lifecycle.promote();
  await tick();
  expect(events).toEqual([{ sequence: 1, status: "ready", result }]);
  // Nothing polls: with no announced change there is no timer and no read.
  expect(f.timers.size).toBe(0);
  result = { kind: "get", document: { id: "one", data: { value: 1 }, revision: "a".repeat(32), updatedAt: "now" } };
  expect(reads).toBe(1);
  invalidate();
  await tick();
  expect(events).toHaveLength(2);
  invalidate();
  await tick();
  expect(events).toHaveLength(2);
  fail = true;
  invalidate();
  await tick();
  await f.next();
  expect(events.at(-1)).toEqual({ sequence: 3, status: "error", errorCode: "db/locked" });
  fail = false;
  await f.next();
  expect(events.at(-1)).toMatchObject({ sequence: 4, status: "ready" });
  subscription.dispose();
  expect(f.timers.size).toBe(0);
  f.lifecycle.stop();
});

test("callbacks are serial, mutation is isolated, failed delivery retries and retirement drops late reads", async () => {
  const f = fixture();
  f.lifecycle.promote();
  const original = { kind: "get", document: null } as const;
  let release!: () => void,
    calls = 0;
  const subscription = f.observer.observe(
    async () => original,
    async (event) => {
      calls++;
      event.sequence = 999;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      if (calls === 1) throw Error("callback failed");
    },
  );
  await tick();
  expect(f.timers.size).toBe(0);
  release();
  await tick();
  await f.next();
  expect(calls).toBe(2);
  release();
  await tick();
  await f.next();
  expect(calls).toBe(2);
  subscription.dispose();
  let finish!: (result: PluginDocumentObservationResult) => void;
  f.observer.observe<unknown>(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    () => {
      calls++;
    },
  );
  // The read is in flight when the plugin retires.
  await tick();
  f.lifecycle.stop();
  finish(original);
  await tick();
  expect(calls).toBe(2);
  expect(f.timers.size).toBe(0);
});

test("observer quotas span collections and subscriptions cannot run during migration", async () => {
  const f = fixture();
  f.lifecycle.beginMigration();
  expect(() =>
    f.observer.observe(
      async () => ({ kind: "get", document: null }),
      () => {},
    ),
  ).toThrow("migration");
  f.lifecycle.finishMigration();
  f.lifecycle.promote();
  const subscriptions = Array.from({ length: 64 }, () =>
    f.observer.observe(
      async () => ({ kind: "page", page: { status: "stale-cursor" } }),
      () => {},
    ),
  );
  expect(() =>
    f.observer.observe(
      async () => ({ kind: "get", document: null }),
      () => {},
    ),
  ).toThrow("Too many");
  subscriptions[0]!.dispose();
  expect(() =>
    f.observer.observe(
      async () => ({ kind: "get", document: null }),
      () => {},
    ),
  ).not.toThrow();
  f.lifecycle.stop();
  await tick();
  expect(f.timers.size).toBe(0);
});

test("a document read spanning commits is retried with both causes, while conflicts and unrelated IDs do not contaminate it", async () => {
  const f = fixture();
  f.lifecycle.promote();
  const seen: PluginDocumentObservation[] = [];
  let reads = 0,
    value = 0,
    release!: (result: PluginDocumentObservationResult) => void;
  const sample = (): PluginDocumentObservationResult => ({
    kind: "get",
    document: { id: "one", data: value, revision: String(value), updatedAt: "now" },
  });
  f.observer.observe<unknown>(
    () =>
      ++reads === 2
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve(sample()),
    (event) => {
      seen.push(event);
    },
    (target) => target.id === "one",
  );
  await tick();
  const target = { collection: "notes", id: "one" };
  await f.observer.write([target], reaction("a"), async () => {
    value = 1;
  });
  const old = sample();
  await f.next();
  await f.observer.write([target], reaction("b"), async () => {
    value = 2;
  });
  release(old);
  await tick();
  expect(seen).toHaveLength(1);
  await f.next();
  expect(seen).toHaveLength(2);
  expect(eventCause(seen[1]!)!.steps).toEqual(["a", "b"]);
  expect(seen[1]).toMatchObject({ result: { document: { data: 2 } } });
  await expect(
    f.observer.write([target], reaction("failed"), async () => {
      throw Error("no commit");
    }),
  ).rejects.toThrow("no commit");
  await f.observer.write(
    [target],
    reaction("conflict"),
    async () => false,
    (result) => result,
  );
  await f.observer.write([{ ...target, id: "unrelated" }], reaction("other"), async () => {});
  await tick();
  expect(seen).toHaveLength(2);
  // A change from outside this window arrives as an invalidation, a new root.
  value = 3;
  invalidate();
  await tick();
  expect(seen).toHaveLength(3);
  expect(eventCause(seen[2]!)!.steps).toEqual([]);
  f.lifecycle.stop();
});

test("unacknowledged local writes hold reads, and failed callback retries retain their cause", async () => {
  const f = fixture();
  f.lifecycle.promote();
  let finish!: () => void,
    reads = 0;
  const pending = f.observer.write(
    [{ collection: "notes", id: "one" }],
    reaction("start"),
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const seen: PluginDocumentObservation[] = [];
  f.observer.observe(
    async () => {
      reads++;
      return { kind: "get", document: null };
    },
    (event) => {
      seen.push(event);
      if (seen.length === 1) throw Error("retry delivery");
    },
  );
  await tick();
  expect(reads).toBe(0);
  finish();
  await pending;
  await tick();
  expect(eventCause(seen[0]!)!.steps).toEqual(["start"]);
  await f.next();
  expect(seen).toHaveLength(2);
  expect(eventCause(seen[1]!)!.steps).toEqual(["start"]);
  expect(() => reactionActor("plugin:docs", "start", eventCause(seen[1]!)!)).toThrow(
    expect.objectContaining({ code: "plugin/event-cycle" }),
  );
  f.lifecycle.stop();
});

test("stable read errors and recovery do not erase the pending document mutation's cause", async () => {
  const f = fixture();
  f.lifecycle.promote();
  let fail = false;
  const seen: PluginDocumentObservation[] = [];
  f.observer.observe(
    async () => {
      if (fail) throw new AppError("db/locked", "controlled");
      return { kind: "get", document: null };
    },
    (event) => {
      seen.push(event);
    },
  );
  await tick();
  fail = true;
  await f.observer.write([{ collection: "notes", id: "one" }], reaction("source"), async () => {});
  await tick();
  await f.next();
  await f.next();
  expect(seen).toHaveLength(2);
  expect(seen[1]).toMatchObject({ status: "error" });
  fail = false;
  await f.next();
  expect(seen).toHaveLength(3);
  expect(eventCause(seen[2]!)!.steps).toEqual(["source"]);
  expect(() => reactionActor("plugin:docs", "source", eventCause(seen[2]!)!)).toThrow(
    expect.objectContaining({ code: "plugin/event-cycle" }),
  );
  f.lifecycle.stop();
});

test("a write through another activation of the same plugin reaches this observer", async () => {
  const f = fixture();
  f.lifecycle.promote();
  const pluginId = `shared-${++fixtures}`;
  const lifecycle = new PluginLifecycleController([]);
  lifecycle.promote();
  const watcher = new PluginDocumentObserver(pluginId, lifecycle);
  const writer = new PluginDocumentObserver(pluginId, f.lifecycle);
  let value = 0;
  const seen: PluginDocumentObservation[] = [];
  watcher.observe(
    async () => ({ kind: "get", document: { id: "one", data: value, revision: String(value), updatedAt: "now" } }),
    (event) => {
      seen.push(event);
    },
  );
  await tick();
  await writer.write([{ collection: "notes", id: "one" }], reaction("elsewhere"), async () => {
    value = 1;
  });
  await tick();
  expect(seen).toHaveLength(2);
  expect(eventCause(seen[1]!)!.steps).toEqual(["elsewhere"]);
  lifecycle.stop();
  f.lifecycle.stop();
});
