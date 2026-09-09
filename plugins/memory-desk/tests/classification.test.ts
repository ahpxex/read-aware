import { expect, test } from "bun:test";
import type { BookClassificationChange, BookClassificationSnapshot, MemoryObservation, PluginContext, PluginFormView, PluginDetailView, PluginViewUpdate } from "@read-aware/plugin-types";
import { classificationView, classificationWords } from "../src/classification";

test("classification consent copy is present in all supported locales", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
    expect(classificationWords(locale)).toHaveLength(10);
    expect(classificationWords(locale).every(word => word.length > 0)).toBe(true);
  }
});

function fixture(write = true) {
  const snapshot: BookClassificationSnapshot = { bookId: "b", narrativity: "narrative", revision: `bcl1:${"a".repeat(64)}` };
  const writes: BookClassificationChange[] = [], updates: PluginViewUpdate[] = [];
  let handler!: (event: MemoryObservation) => unknown, stopped = false;
  const ctx = { locale: "en", domains: { memory: { queries: { classification: async () => snapshot },
    ...(write ? { commands: { classify: async (input: BookClassificationChange) => { writes.push(input); } } } : {}),
    events: { observe: (_: unknown, callback: typeof handler) => { handler = callback; return { dispose() { stopped = true; } }; } },
  } }, services: { ui: { publishView: async (_: unknown, update: PluginViewUpdate) => { updates.push(update); } } } } as unknown as PluginContext;
  return { ctx, snapshot, writes, updates, emit: (event: MemoryObservation) => handler(event), stopped: () => stopped };
}
test("classification read-only views do not grant mutation and explicit forms require confirmation", async () => {
  expect((await classificationView(fixture(false).ctx, "b")).actions!.map(a => a.id)).toEqual(["refresh"]);
  const f = fixture(), view = await classificationView(f.ctx, "b");
  const form = (await view.actions!.find(a => a.id === "classify")!.run())!.view as PluginFormView;
  expect(await form.onSubmit({ narrativity: "expository", confirm: false })).toHaveProperty("fieldErrors.confirm");
  expect(await form.onSubmit({ narrativity: "poetry", confirm: true })).toHaveProperty("fieldErrors.narrativity");
  expect(f.writes).toHaveLength(0);
  const revision = f.snapshot.revision; f.snapshot.revision = `bcl1:${"b".repeat(64)}`;
  await form.onSubmit({ narrativity: "expository", confirm: true });
  expect(f.writes).toEqual([{ bookId: "b", narrativity: "expository", expectedRevision: revision }]);
});
test("classification observation clears stale actions on failures and deletion, recovers, and releases", async () => {
  const f = fixture(), view = await classificationView(f.ctx, "b"), sub = await view.live!.subscribe({ id: "channel" });
  await f.emit({ status: "error", revision: 1, errorCode: "db/error" });
  expect(f.updates[0]!.view).toMatchObject({ content: [{ kind: "error", code: "db/error" }] });
  expect((f.updates[0]!.view as PluginDetailView).actions).toBeUndefined();
  await f.emit({ status: "ready", revision: 2, result: { kind: "classification", snapshot: { ...f.snapshot, narrativity: "expository" } } });
  expect(JSON.stringify(f.updates[1])).toContain("Expository");
  await f.emit({ status: "ready", revision: 3, result: { kind: "classification", snapshot: null } });
  expect((f.updates[2]!.view as PluginDetailView).actions).toBeUndefined();
  sub.dispose(); await f.emit({ status: "error", revision: 4, errorCode: "late" });
  expect(f.updates).toHaveLength(3); expect(f.stopped()).toBe(true);
});
test("failed classification rejects without returning replacement or clearing the frozen form", async () => {
  const f = fixture(), view = await classificationView(f.ctx, "b");
  const form = (await view.actions!.find(a => a.id === "classify")!.run())!.view as PluginFormView;
  f.ctx.domains.memory!.commands!.classify = async () => { throw Object.assign(Error("PRIVATE"), { code: "memory/conflict" }); };
  await expect(form.onSubmit({ narrativity: "expository", confirm: true })).rejects.toMatchObject({ code: "memory/conflict" });
  expect(form.fields[0]).toMatchObject({ value: "narrative" });
});
