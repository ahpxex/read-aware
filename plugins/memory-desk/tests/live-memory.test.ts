import { expect, test } from "bun:test";
import type { MemoryObservation, MemoryObservationQuery, MemorySnapshot, MemoryRecord, PluginContext, PluginDetailView, PluginFormView, PluginViewUpdate } from "@read-aware/plugin-types";
import { memories } from "../src/views";
import { memoryDetail } from "../src/management";
import { graphView } from "../src/graph";
import { liveMemoryView } from "../src/live-memory";

const page = (items: MemoryRecord[]) => ({ items, total: items.length, offset: 0, nextOffset: null, revision: `mpg1:${"a".repeat(64)}` });

test("shared observation adapter routes profileContext to its matching query, never the graph fallback", async () => {
  const f = fixture(), queries: unknown[] = [];
  f.ctx.domains.memory!.queries.profileContext = async query => {
    queries.push(query);
    return { kind: "summary", text: "Inferred", totalLength: 8, offset: 0, nextOffset: null,
      revision: `pctx1:${"a".repeat(64)}`, curatedRevision: `profile2:${"a".repeat(64)}`, curatedExists: true, derivedStatus: "current" };
  };
  const query = { kind: "profileContext" as const, query: { kind: "summary" as const, limit: 100 } };
  const view = await liveMemoryView(f.ctx, query, "Test", result => {
    if (result.kind !== "profileContext" || result.page.kind !== "summary") throw Error("Unexpected result");
    return { kind: "detail", title: "Test", content: [{ kind: "text", text: result.page.text ?? "" }] };
  });
  expect(view).toMatchObject({ content: [{ kind: "text", text: "Inferred" }] });
  expect(queries).toEqual([query.query]);
  const subscription = await view.live!.subscribe({ id: "channel" });
  expect(f.requests).toEqual([query]); subscription.dispose();
  expect(f.writes).toHaveLength(0);
});

function fixture() {
  let handler!: (event: MemoryObservation) => unknown, stopped = 0;
  const requests: MemoryObservationQuery[] = [], updates: PluginViewUpdate[] = [], writes: unknown[] = [];
  const snapshot = (content: string, revision: string, pinned = false): MemorySnapshot => ({ revision,
    memory: { id: "m", scope: "user", kind: "fact", content, importance: 0.5, evidenceCount: 1, createdAt: "now", updatedAt: "now", pinned } });
  const original = snapshot("Original", "mem1:a");
  const ctx = { locale: "en", domains: { memory: {
    queries: { inspect: async () => original, page: async () => page([original.memory]), bookGraph: async () => ({ graph: "chapter", chapterIndex: 2, chapterHref: "two", summary: "Visible chapter", entities: [], relations: [] }) },
    commands: { mutate: async (input: unknown) => { writes.push(input); } },
    events: { observe: (query: MemoryObservationQuery, callback: typeof handler) => { requests.push(query); handler = callback; return { dispose() { stopped++; } }; } },
  } }, services: { ui: { publishView: async (_: unknown, update: PluginViewUpdate) => { updates.push(update); return { status: "applied" }; } } } } as unknown as PluginContext;
  return { ctx, requests, updates, writes, snapshot, emit: (event: MemoryObservation) => handler(event), stopped: () => stopped };
}
test("live search changes results, clears failed content/actions and recovers without an empty-state lie", async () => {
  const f = fixture(), view = await memories(f.ctx, "user", "term");
  const subscription = await view.live!.subscribe({ id: "channel" });
  expect(f.requests).toEqual([{ kind: "page", query: { scopes: ["user"], query: "term", limit: 20, offset: 0 } }]);
  await f.emit({ revision: 1, status: "ready", result: { kind: "page", page: page([f.snapshot("Changed", "mem1:b").memory]) } });
  expect(f.updates[f.updates.length - 1]?.view).toMatchObject({ kind: "list", items: [{ title: "Changed" }] });
  await f.emit({ revision: 2, status: "error", errorCode: "db/locked" });
  expect(f.updates[f.updates.length - 1]?.view).toMatchObject({ kind: "detail", title: "Personal memory", content: [{ kind: "error", code: "db/locked" }] });
  expect((f.updates[f.updates.length - 1]?.view as PluginDetailView).actions?.map(action => action.id)).toEqual(["refresh"]);
  await f.emit({ revision: 3, status: "ready", result: { kind: "page", page: page([]) } });
  expect(f.updates[f.updates.length - 1]?.view).toMatchObject({ kind: "list", items: [] });
  subscription.dispose(); const count = f.updates.length;
  await f.emit({ revision: 4, status: "error", errorCode: "late" });
  expect(f.updates).toHaveLength(count); expect(f.stopped()).toBe(1);
});
test("updated detail actions use the new revision without rebasing an already opened correction form", async () => {
  const f = fixture(), view = await memoryDetail(f.ctx, "m", () => memories(f.ctx, "user"));
  const form = (await view.actions!.find(action => action.id === "correct")!.run())!.view as PluginFormView;
  const subscription = await view.live!.subscribe({ id: "channel" });
  await f.emit({ revision: 1, status: "ready", result: { kind: "inspect", snapshot: f.snapshot("Concurrent edit", "mem1:b", true) } });
  const updated = f.updates[f.updates.length - 1]!.view as PluginDetailView;
  expect(updated.actions!.find(action => action.id === "pin")!.label).toBe("Unpin");
  await updated.actions!.find(action => action.id === "pin")!.run();
  expect(f.writes[0]).toMatchObject({ expectedRevision: "mem1:b", pinned: false });
  expect(form.fields[0]).toMatchObject({ value: "Original" });
  await form.onSubmit({ content: "User draft" });
  expect(f.writes[1]).toMatchObject({ expectedRevision: "mem1:a", content: "User draft" });
  await f.emit({ revision: 2, status: "ready", result: { kind: "inspect", snapshot: null } });
  expect(f.updates[f.updates.length - 1]!.view).toMatchObject({ content: [{ kind: "error", code: "memory/not-found" }] });
  expect((f.updates[f.updates.length - 1]!.view as PluginDetailView).actions).toBeUndefined(); subscription.dispose();
});
test("initial read errors can recover and graph errors never retain stale spoiler content", async () => {
  const f = fixture(); f.ctx.domains.memory!.queries.bookGraph = async () => { throw Object.assign(Error("PRIVATE"), { code: "db/error" }); };
  const view = await graphView(f.ctx, "b", { chapterIndex: 2 });
  expect(view).toMatchObject({ content: [{ kind: "error", code: "db/error" }] });
  const subscription = await view.live!.subscribe({ id: "channel" });
  await f.emit({ revision: 1, status: "ready", result: { kind: "bookGraph", graph: { graph: "chapter", chapterIndex: 2, chapterHref: "two", summary: "Revealed", entities: [], relations: [] } } });
  expect((f.updates[f.updates.length - 1]!.view as PluginDetailView).content[0]).toEqual({ kind: "text", text: "Revealed" });
  await f.emit({ revision: 2, status: "error", errorCode: "db/error" });
  expect(JSON.stringify(f.updates[f.updates.length - 1])).not.toContain("Revealed");
  await f.emit({ revision: 3, status: "ready", result: { kind: "bookGraph", graph: { graph: "miss", note: "Withheld" } } });
  expect((f.updates[f.updates.length - 1]!.view as PluginDetailView).actions?.some(action => action.id === "source")).toBe(false);
  subscription.dispose();
});
