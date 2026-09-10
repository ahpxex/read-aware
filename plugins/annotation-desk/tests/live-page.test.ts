import { expect, test } from "bun:test";
import type { AnnotationObservation, AnnotationPageQuery, PluginViewUpdate } from "@read-aware/plugin-types";
import { liveAnnotationPage } from "../src/live-page";
import type { DeskContext } from "../src/types";

function fixture() {
  let handler!: (event: AnnotationObservation) => unknown, stopped = false;
  const updates: PluginViewUpdate[] = [];
  const page = { items: [], nextCursor: null, consistency: "live" as const };
  const ctx = { locale: "en", domains: { annotations: { queries: { page: async () => page }, events: {
    observe: (_query: unknown, callback: typeof handler) => { handler = callback; return { dispose() { stopped = true; } }; },
  } } }, services: { ui: { publishView: async (_channel: unknown, update: PluginViewUpdate) => { updates.push(update); } } } } as unknown as DeskContext;
  return { ctx, page, updates, emit: (event: AnnotationObservation) => handler(event), stopped: () => stopped };
}
test("live pages clear stale actions on error and restore fresh snapshots without leaking raw errors", async () => {
  const f = fixture(); let title = "initial";
  const view = await liveAnnotationPage(f.ctx, {}, async () => ({ kind: "list", title, items: [], actions: [{ id: "old", label: "Select", run() {} }] }));
  const sub = await view.live!.subscribe({ id: "channel" });
  await f.emit({ revision: 1, status: "error", errorCode: "db/locked" });
  expect(f.updates[0]!.view).toMatchObject({ kind: "detail", content: [{ kind: "error", code: "db/locked" }] });
  expect(f.updates[0]!.view).not.toHaveProperty("actions");
  title = "new snapshot"; await f.emit({ revision: 2, status: "ready", result: { kind: "page", page: f.page } });
  expect(f.updates[1]!.view).toMatchObject({ kind: "list", title: "new snapshot" });
  sub.dispose(); await f.emit({ revision: 3, status: "error", errorCode: "late" });
  expect(f.updates).toHaveLength(2); expect(f.stopped()).toBe(true);
});
test("joined read failure stays unacknowledged so unchanged pages can recover", async () => {
  const f = fixture(); let failed = true;
  const view = await liveAnnotationPage(f.ctx, {}, async () => {
    if (failed) throw Object.assign(Error("PRIVATE_BOOK_READ"), { code: "db/locked" });
    return { kind: "list", title: "Recovered", items: [] };
  });
  expect(JSON.stringify(view)).not.toContain("PRIVATE_BOOK_READ");
  const sub = await view.live!.subscribe({ id: "channel" });
  const event = { revision: 1, status: "ready" as const, result: { kind: "page" as const, page: f.page } };
  await expect(f.emit(event)).rejects.toThrow("PRIVATE_BOOK_READ");
  expect(f.updates[0]!.view).toMatchObject({ kind: "detail" });
  failed = false; await f.emit({ ...event, revision: 2 });
  expect(f.updates[1]!.view).toMatchObject({ kind: "list", title: "Recovered" }); sub.dispose();
});
test("disposal during async rendering drops the late result and the query is frozen", async () => {
  const f = fixture(); let resolve: (() => void) | undefined, hold = false;
  const input: AnnotationPageQuery = { bookId: "b", limit: 20 };
  let observed: unknown;
  const observe = f.ctx.domains.annotations.events.observe;
  f.ctx.domains.annotations.events.observe = (query, callback) => { observed = query; return observe(query, callback); };
  const view = await liveAnnotationPage(f.ctx, input, async () => { if (hold) await new Promise<void>(r => { resolve = r; }); return { kind: "list", items: [] }; });
  input.bookId = "other"; const sub = await view.live!.subscribe({ id: "channel" }); expect(observed).toMatchObject({ query: { bookId: "b" } });
  hold = true; const work = f.emit({ revision: 1, status: "ready", result: { kind: "page", page: f.page } });
  await Promise.resolve(); sub.dispose(); resolve!(); await work;
  expect(f.updates).toHaveLength(0);
});
