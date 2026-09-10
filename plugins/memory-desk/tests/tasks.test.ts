import { expect, test } from "bun:test";
import type { BookGraphTaskSnapshot, PluginContext, PluginFormView, PluginDetailView, PluginViewUpdate, MemoryObservation } from "@read-aware/plugin-types";
import { graphTasksView, graphTaskView, graphTaskWords } from "../src/tasks";
import { taskBudgetWords } from "../src/task-budget";

function fixture() {
  const task: BookGraphTaskSnapshot = { bookId: "b", taskId: "task", mode: "rebuild", maxChapters: 2, status: "running", revision: 1, createdAt: "now", updatedAt: "now" };
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
    expect(Object.values(taskBudgetWords(locale)).every(Boolean)).toBe(true);
  }
  const f = fixture(), view = await graphTasksView(f.ctx, "b");
  const form = (await view.actions!.find(action => action.id === "rebuild")!.run())!.view as PluginFormView;
  expect(form.fields[0]).toMatchObject({ kind: "number", value: 20, min: 1, max: 1000, step: 1 });
  expect(await form.onSubmit({ confirm: false, maxChapters: 1 })).toHaveProperty("fieldErrors.confirm"); expect(f.calls).toHaveLength(0);
  for (const value of [0, 1001, 1.5, "1", NaN]) expect(await form.onSubmit({ confirm: true, maxChapters: value })).toHaveProperty("fieldErrors.maxChapters");
  await form.onSubmit({ confirm: true, maxChapters: 1 }); expect(f.calls).toEqual([["b", "rebuild", { maxChapters: 1 }]]);
});
test("task observation follows cancellation, errors clear actions, recovery and disposal stay scoped", async () => {
  const f = fixture(), view = await graphTaskView(f.ctx, "b", "task"), sub = await view.live!.subscribe({ id: "channel" });
  const progress = (view as PluginDetailView).content.find(block => block.kind === "progress");
  if (progress?.kind !== "progress" || !progress.cancel) throw new Error("Expected cancellable progress");
  expect(progress.value).toBeNull();
  await progress.cancel.run(); expect(f.task.status).toBe("cancelling");
  await f.emit({ revision: 1, status: "ready", result: { kind: "graphTask", task: f.task } });
  expect((f.updates[0]!.view as PluginDetailView).actions!.map(action => action.id)).toEqual(["refresh"]);
  expect((f.updates[0]!.view as PluginDetailView).content[0]).toMatchObject({ kind: "progress", value: null, cancel: undefined });
  await f.emit({ revision: 2, status: "error", errorCode: "memory/task-not-found" });
  expect((f.updates[1]!.view as PluginDetailView).actions).toBeUndefined();
  f.task.status = "partial";
  await f.emit({ revision: 3, status: "ready", result: { kind: "graphTask", task: f.task } });
  const retry = (await (f.updates[2]!.view as PluginDetailView).actions!.find(action => action.id === "retry")!.run())!.view as PluginFormView;
  expect((f.updates[2]!.view as PluginDetailView).content.some(block => block.kind === "progress")).toBe(false);
  expect(retry.fields[0]).toMatchObject({ value: 2 });
  await retry.onSubmit({ confirm: true, maxChapters: 3 }); expect(f.calls).toEqual([["b", "task", { maxChapters: 3 }]]);
  sub.dispose(); await f.emit({ revision: 4, status: "error", errorCode: "late" }); expect(f.updates).toHaveLength(3); expect(f.stopped()).toBe(true);
});

test("task details identify budget stops, unavailable reasons, empty chapters and failed chapter numbers", async () => {
  const f = fixture();
  f.task.report = { status: "partial", reason: "chapter-limit", eligible: 4, attempted: 2, digested: 0, remaining: 4, emptyChapters: [0], failures: [{ chapterIndex: 1, errorCode: "ai/provider" }] };
  const view = await graphTaskView(f.ctx, "b", "task") as PluginDetailView;
  expect(view.content).toContainEqual({ kind: "text", text: "Chapter limit reached" });
  expect(view.content).toContainEqual({ kind: "keyValue", rows: [{ label: "Empty chapters", value: "1" }] });
  expect(view.content).toContainEqual({ kind: "heading", text: "Chapter 2" });
  expect(view.content).toContainEqual({ kind: "error", code: "ai/provider" });
  for (const reason of ["boundary-unknown", "no-toc", "classification-pending"] as const) {
    f.task.report.reason = reason;
    const result = await graphTaskView(f.ctx, "b", "task") as PluginDetailView;
    expect(result.content.some(block => block.kind === "text" && block.text.length > 0)).toBe(true);
  }
});
