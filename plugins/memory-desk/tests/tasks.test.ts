import { expect, test } from "bun:test";
import type { BookGraphTaskSnapshot, PluginContext, PluginFormView, PluginDetailView, PluginViewUpdate, MemoryObservation } from "@read-aware/plugin-types";
import { graphTasksView, graphTaskView, graphTaskWords } from "../src/tasks";

function fixture() {
  const task: BookGraphTaskSnapshot = { bookId: "b", taskId: "task", mode: "rebuild", status: "running", revision: 1, createdAt: "now", updatedAt: "now" };
  const calls: unknown[] = [], updates: PluginViewUpdate[] = []; let handler!: (event: MemoryObservation) => unknown, stopped = false;
  const ctx = { locale: "en", domains: { memory: { queries: { listGraphTasks: async () => [task], getGraphTask: async () => task },
    commands: { startGraphTask: async (...args: unknown[]) => { calls.push(args); return task; }, retryGraphTask: async (...args: unknown[]) => { calls.push(args); return task; }, cancelGraphTask: async () => { task.status = "cancelling"; return task; } },
    events: { observe: (_: unknown, listener: typeof handler) => { handler = listener; return { dispose() { stopped = true; } }; } },
  } }, services: { ui: { publishView: async (_: unknown, update: PluginViewUpdate) => { updates.push(update); } } } } as unknown as PluginContext;
  return { ctx, task, calls, updates, stopped: () => stopped, emit: (event: MemoryObservation) => handler(event) };
}
test("task strings cover all locales, start and rebuild require confirmation", async () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
    expect(graphTaskWords(locale)).toHaveLength(21); expect(graphTaskWords(locale).every(Boolean)).toBe(true);
  }
  const f = fixture(), view = await graphTasksView(f.ctx, "b");
  const form = (await view.actions!.find(action => action.id === "rebuild")!.run())!.view as PluginFormView;
  expect(await form.onSubmit({ confirm: false })).toHaveProperty("fieldErrors.confirm"); expect(f.calls).toHaveLength(0);
  await form.onSubmit({ confirm: true }); expect(f.calls).toEqual([["b", "rebuild"]]);
});
test("task observation follows cancellation, errors clear actions, recovery and disposal stay scoped", async () => {
  const f = fixture(), view = await graphTaskView(f.ctx, "b", "task"), sub = await view.live!.subscribe({ id: "channel" });
  await view.actions!.find(action => action.id === "cancel")!.run(); expect(f.task.status).toBe("cancelling");
  await f.emit({ revision: 1, status: "ready", result: { kind: "graphTask", task: f.task } });
  expect((f.updates[0]!.view as PluginDetailView).actions!.map(action => action.id)).toEqual(["refresh"]);
  await f.emit({ revision: 2, status: "error", errorCode: "memory/task-not-found" });
  expect((f.updates[1]!.view as PluginDetailView).actions).toBeUndefined();
  f.task.status = "partial";
  await f.emit({ revision: 3, status: "ready", result: { kind: "graphTask", task: f.task } });
  const retry = (await (f.updates[2]!.view as PluginDetailView).actions!.find(action => action.id === "retry")!.run())!.view as PluginFormView;
  await retry.onSubmit({ confirm: true }); expect(f.calls).toEqual([["b", "task"]]);
  sub.dispose(); await f.emit({ revision: 4, status: "error", errorCode: "late" }); expect(f.updates).toHaveLength(3); expect(f.stopped()).toBe(true);
});
