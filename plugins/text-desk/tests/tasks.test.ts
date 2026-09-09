import { expect, test } from "bun:test";
import type { BookTextTaskSnapshot, PluginContext, PluginDetailView, PluginViewUpdate } from "@read-aware/plugin-types";
import { rebuildForm, requestDetail, requestList, startRequest } from "../src/task-views";

function harness() {
  const starts: unknown[] = [], cancelled: string[] = [];
  let fails = false;
  const task: BookTextTaskSnapshot = { taskId: "task", bookId: "book", mode: "prepare", status: "running", revision: 1,
    createdAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:00:00Z",
    textState: { bookId: "book", contentVersion: "v", status: "preparing", text: "unknown", chapterCount: 0,
      progress: { completed: 1, failed: 0, unsupported: 0, total: 3 } } };
  const ctx = { locale: "en", domains: { library: { queries: { books: {
    getTextTask: async (bookId: string, taskId: string) => {
      expect(bookId).toBe("book"); expect(taskId).toBe("task");
      if (fails) throw Error("private native failure"); return structuredClone(task);
    }, listTextTasks: async () => [structuredClone(task)],
  } }, commands: { books: {
    prepareText: async (bookId: string, options: unknown) => { starts.push({ bookId, options }); return structuredClone(task); },
    cancelTextTask: async (bookId: string, taskId: string) => {
      if (fails) throw Error("cancel failed"); expect(bookId).toBe("book"); cancelled.push(taskId); task.status = "cancelled";
    },
  } } } } } as unknown as PluginContext;
  return { ctx, task, starts, cancelled, fail: () => { fails = true; } };
}

test("prepare shows a request receipt, refresh reads progress, cancel is explicitly request-scoped", async () => {
  const h = harness();
  const result = await startRequest(h.ctx, "book", "Book");
  expect(h.starts).toEqual([{ bookId: "book", options: { rebuild: false } }]);
  expect(result.view.content[0]).toMatchObject({ rows: expect.arrayContaining([{ label: "Request", value: "Running" }]) });
  h.task.textState.progress!.completed = 2;
  const refreshed = await result.view.actions!.find(a => a.id === "refresh")!.run();
  expect((refreshed!.view as PluginDetailView).content[0]).toMatchObject({ rows: expect.arrayContaining([{ label: "Read sections", value: "2 / 3" }]) });
  const cancel = result.view.actions!.find(a => a.id === "cancel")!;
  expect(cancel.label).toBe("Cancel this request");
  const after = await cancel.run(); expect(h.cancelled).toEqual(["task"]);
  expect((after!.view as PluginDetailView).actions!.some(a => a.id === "cancel")).toBe(false);
  expect((after!.view as PluginDetailView).content[0]).toMatchObject({ rows: expect.arrayContaining([{ label: "Request", value: "Request cancelled" }]) });
});

test("rebuild requires explicit confirmation and replaces the confirmation with its request", async () => {
  const h = harness(), form = rebuildForm(h.ctx, "book", "Book");
  for (const confirm of [false, "true", 1]) expect(await form.onSubmit({ confirm })).toMatchObject({ fieldErrors: { confirm: expect.any(String) } });
  expect(h.starts).toEqual([]);
  expect(await form.onSubmit({ confirm: true })).toMatchObject({ navigation: "replace", view: { kind: "detail" } });
  expect(h.starts).toEqual([{ bookId: "book", options: { rebuild: true } }]);
});

test("task list drills into its exact handle, failed queries and cancels do not report success", async () => {
  const h = harness(), list = await requestList(h.ctx, "book", "Book");
  expect(list.items[0]!.id).toBe("task");
  const detail = (await list.items[0]!.onSelect!())!.view as PluginDetailView;
  h.fail();
  await expect(detail.actions!.find(a => a.id === "cancel")!.run()).rejects.toThrow("cancel failed");
  await expect(requestDetail(h.ctx, "book", "Book", "task")).rejects.toThrow();
  expect(h.cancelled).toEqual([]);
});

test("request views publish initial, progress and terminal snapshots; hiding releases observation, not the request", async () => {
  const h = harness(), updates: PluginViewUpdate[] = [];
  let observer: ((task: BookTextTaskSnapshot) => void | Promise<void>) | undefined;
  h.ctx.domains.library!.events = { ...h.ctx.domains.library!.events,
    observeTextTask: (bookId, taskId, callback) => {
      expect([bookId, taskId]).toEqual(["book", "task"]);
      observer = callback; void callback(structuredClone(h.task));
      return { dispose() { observer = undefined; } };
    },
  };
  h.ctx.services = { ui: { publishView: async (channel, update) => {
    expect(channel).toEqual({ id: "visible-frame" }); updates.push(update); return { status: "applied" };
  } } } as PluginContext["services"];
  const detail = await requestDetail(h.ctx, "book", "Book", "task");
  expect(updates).toEqual([]);
  const subscription = await detail.live!.subscribe({ id: "visible-frame" });
  expect(updates[0].revision).toBe(1);
  h.task.revision = 2; h.task.textState.progress!.completed = 2;
  await observer!(structuredClone(h.task));
  expect((updates[1].view as PluginDetailView).content[0]).toMatchObject({ rows: expect.arrayContaining([{ label: "Read sections", value: "2 / 3" }]) });
  h.task.revision = 3; h.task.status = "completed";
  await observer!(structuredClone(h.task));
  expect(updates.map(update => update.revision)).toEqual([1, 2, 3]);
  expect((updates[2].view as PluginDetailView).actions!.some(action => action.id === "cancel")).toBe(false);
  expect(updates.every(update => !("live" in update.view))).toBe(true);
  subscription.dispose(); expect(observer).toBeUndefined(); expect(h.cancelled).toEqual([]);
});
