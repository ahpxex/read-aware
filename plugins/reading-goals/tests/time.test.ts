import { expect, test } from "bun:test";
import type { PluginContext, PluginDetailView, PluginView, PluginListView, ReadingTimeObservation, ReadingTimeSnapshot } from "@read-aware/plugin-types";
import { readingTimeView, timeDuration } from "../src/time-view";

test("reading time composes bounded queries, live failure states, pending pages and disposal", async () => {
  const queryCalls: unknown[] = [], published: unknown[] = [];
  let observe!: (event: ReadingTimeObservation) => void | Promise<void>, disposed = 0;
  const sample: ReadingTimeSnapshot = { bookId: "b", localDay: null, observedAtEpochMs: 1_000_000, settledMs: 1000, pendingMs: 2000, totalMs: 3000,
    pendingBucketCount: 1, pending: [{ bookId: "b", localDay: "2026-09-09", localHour: 1, ms: 2000, startedAt: 1, lastAt: 3, positionAt: null }],
    nextCursor: { bookId: "b", localDay: "2026-09-09", localHour: 1 } };
  const ctx = { locale: "en", domains: {
    reading: { queries: { stats: { time: async (query: unknown) => { queryCalls.push(query); return sample; } } }, events: {
      observeTime(query: unknown, handler: typeof observe) { queryCalls.push(query); observe = handler; return { dispose() { disposed++; } }; },
    } }, library: { queries: { books: { get: async () => ({ title: "Book" }) } } },
  }, services: { ui: { publishView: async (_channel: unknown, update: unknown) => { published.push(update); } } } } as unknown as PluginContext;
  const view = await readingTimeView(ctx, { bookId: "b" }) as PluginDetailView & PluginView;
  const live = await view.live!.subscribe({ id: "time" });
  await observe({ status: "ready", revision: 1, snapshot: sample });
  await observe({ status: "error", revision: 2, errorCode: "db/locked" });
  expect(JSON.stringify(published[1])).toContain('"kind":"error","code":"db/locked"');
  expect(JSON.stringify(published[1])).toContain("Last successful sample");
  const list = (await view.actions!.find(action => action.id === "pending")!.run())!.view as PluginListView;
  await list.actions!.find(action => action.id === "next")!.run();
  expect(queryCalls).toEqual([{ bookId: "b", limit: 10 }, { bookId: "b", limit: 10 },
    { bookId: "b", after: undefined, limit: 25 }, { bookId: "b", after: sample.nextCursor, limit: 25 }]);
  live.dispose(); expect(disposed).toBe(1);
  expect(timeDuration(3_661_234)).toBe("1:01:01");
});
