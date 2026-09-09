import { expect, test } from "bun:test";
import { AppError, normalizeWorkspaceTarget, type WorkspaceSnapshot, type WorkspaceTarget } from "@read-aware/core";
import { WorkspaceService, type WorkspaceView } from "./workspace";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const initial = (): WorkspaceView => ({ surface: "shelf", collectionId: null, settings: { open: false, section: null },
  search: { open: false, query: "" }, selection: { active: false, bookIds: [] } });
function fixture(deadline = 1000) {
  const errors: unknown[] = [], view = initial();
  const service = new WorkspaceService(error => errors.push(error), deadline);
  let token = 0, hold = false, release!: () => void, prepareError: unknown, applied = 0;
  const binding = service.bind({
    prepare: async (_target, signal) => {
      if (hold) await new Promise<void>(resolve => { release = resolve; });
      signal.throwIfAborted(); if (prepareError) throw prepareError;
    },
    apply: async (target, signal) => {
      signal.throwIfAborted(); applied++;
      view.settings.open = false; view.search.open = false;
      if (target.surface === "settings") view.settings = { open: true, section: target.section! };
      else if (target.surface === "search") view.search = { open: true, query: target.query! };
      else {
        view.surface = target.surface;
        if (target.surface === "shelf") { view.collectionId = target.collectionId!; view.selection = target.selection ?? { active: false, bookIds: [] }; }
      }
    }, requestCommit: value => { token = value; },
  }, view);
  return { service, binding, view, errors, get applied() { return applied; }, get token() { return token; },
    hold: () => { hold = true; }, release: () => { hold = false; release(); }, fail: (error: unknown) => { prepareError = error; },
    publish: () => binding.publish(view, token), ack: (surface: string) => service.acknowledge(surface, token),
  };
}

test("workspace receipts require a matching fresh destination commit, not dispatch or Suspense fallback", async () => {
  const f = fixture(); let settled = false;
  const result = f.service.navigate({ surface: "stats" }).then(v => { settled = true; return v; });
  await tick(); f.publish(); await tick(); expect(settled).toBe(false);
  f.service.acknowledge("stats", f.token - 1); await tick(); expect(settled).toBe(false);
  f.ack("stats"); expect((await result).snapshot.surface).toBe("stats");
  const again = f.service.navigate({ surface: "stats" }); await tick(); f.ack("stats"); f.publish();
  expect((await again).status).toBe("completed"); f.binding.dispose();
});
test("settings intermediary commits do not acknowledge a wrong section; search preserves its explicit query", async () => {
  const f = fixture(); const result = f.service.navigate({ surface: "settings", section: "reading" }); await tick();
  f.view.settings.section = "general"; f.ack("settings"); f.publish();
  f.view.settings.section = "reading"; f.publish(); expect((await result).snapshot.settings.section).toBe("reading");
  const search = f.service.navigate({ surface: "search", query: "A book" }); await tick(); f.publish(); f.ack("search");
  expect((await search).snapshot.search.query).toBe("A book"); f.binding.dispose();
});
test("paged selection snapshots have stable code-unit order, independent copies and real continuation", () => {
  const f = fixture(); f.view.selection = { active: true, bookIds: ["c", "a", "b", "a"] }; f.publish();
  const page = f.service.snapshot({ limit: 2 }); expect(page.selection).toEqual({ active: true, bookIds: ["a", "b"], total: 3, nextCursor: "b" });
  expect(f.service.snapshot({ limit: 2, selectionAfter: "b" }).selection.bookIds).toEqual(["c"]);
  page.selection.bookIds.length = 0; expect(f.service.snapshot().selection.total).toBe(3); f.binding.dispose();
});
test("bad shapes, stale revisions and pre-abort never dispatch", async () => {
  const f = fixture();
  for (const target of [null, { surface: "other" }, { surface: "search", query: 42 }, { surface: "settings", section: "missing" },
    { surface: "shelf", selection: { active: false, bookIds: ["book"] } }]) {
    await expect(f.service.navigate(target as WorkspaceTarget)).rejects.toMatchObject({ code: "ui/invalid-target" });
  }
  await expect(f.service.navigate({ surface: "stats" }, -1)).rejects.toMatchObject({ code: "ui/invalid-target" });
  await expect(f.service.navigate({ surface: "stats" }, 0)).rejects.toMatchObject({ code: "ui/superseded" });
  const abort = new AbortController(); abort.abort(new Error("stopped"));
  await expect(f.service.navigate({ surface: "stats" }, undefined, abort.signal)).rejects.toThrow("stopped");
  for (const query of [{ limit: 0 }, { limit: 1001 }, { selectionAfter: "" }, null]) expect(() => f.service.snapshot(query as never)).toThrow();
  expect(f.applied).toBe(0); f.binding.dispose();
});
test("native edits during asynchronous validation win; errors never become empty success", async () => {
  const f = fixture(); f.hold(); const result = f.service.navigate({ surface: "stats" }).catch(e => e);
  f.view.collectionId = "native"; f.publish(); f.release();
  expect(await result).toMatchObject({ code: "ui/superseded" }); expect(f.applied).toBe(0);
  const error = new AppError("db/locked", "private native message"); f.fail(error);
  expect(await f.service.navigate({ surface: "stats" }).catch(e => e)).toBe(error); f.binding.dispose();
});
test("replacement, lifecycle cancellation, timeout and detach settle held operations without late application", async () => {
  for (const end of ["replace", "abort", "timeout", "detach"]) {
    const f = fixture(end === "timeout" ? 5 : 1000), abort = new AbortController(); f.hold();
    const old = f.service.navigate({ surface: "stats" }, undefined, abort.signal).catch(e => e);
    let next: Promise<unknown> | undefined;
    if (end === "abort") abort.abort(new AppError("ui/superseded", "owner stopped"));
    if (end === "detach") f.binding.dispose();
    if (end === "replace") { f.release(); next = f.service.navigate({ surface: "agent" }); }
    expect(await old).toMatchObject({ code: end === "timeout" ? "ui/timeout" : "ui/superseded" });
    if (end !== "replace") f.release(); await tick();
    if (next) { f.publish(); f.ack("agent"); await next; expect(f.applied).toBe(1); }
    else expect(f.applied).toBe(0);
    f.binding.dispose(); expect(() => f.service.snapshot()).toThrow();
  }
});
test("observer backpressure coalesces changes, isolates failure and ends without late delivery", async () => {
  const f = fixture(), seen: (WorkspaceSnapshot | null)[] = []; let release!: () => void;
  const off = f.service.observe({}, async state => { seen.push(state); await new Promise<void>(resolve => { release = resolve; }); });
  for (let n = 0; n < 20; n++) { f.view.search.query = String(n); f.publish(); }
  expect(seen.length).toBe(1); release(); await tick(); expect(seen.length).toBe(2); expect(seen[1]?.search.query).toBe("19");
  off(); release(); f.binding.dispose(); await tick(); expect(seen.length).toBe(2);
  const bad = f.service.observe({}, () => { throw new Error("observer"); }); await tick(); expect(f.errors.length).toBe(1); bad();
});
test("observation cap and cloned normalized input prevent unbounded resources and caller mutation", () => {
  const f = fixture(); const stops = Array.from({ length: 64 }, () => f.service.observe({}, () => {}));
  expect(() => f.service.observe({}, () => {})).toThrow(); for (const stop of stops) stop();
  f.service.observe({}, () => {})(); f.binding.dispose();
  const input: WorkspaceTarget = { surface: "shelf", selection: { active: true, bookIds: ["a", "a"] } };
  const copy = normalizeWorkspaceTarget(input); input.selection!.bookIds.push("b");
  expect(copy).toEqual({ surface: "shelf", collectionId: null, selection: { active: true, bookIds: ["a"] } });
});
