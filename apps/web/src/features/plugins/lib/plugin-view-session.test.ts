import { expect, test } from "bun:test";
import type { PluginDetailView, PluginView, PluginViewResult } from "./plugin-types";
import { PluginViewSession } from "./plugin-view-session";
import { AppError } from "@read-aware/core";
import { setPluginToastHandler } from "./plugin-toast";
import { decodePluginCallbacks, PluginCallbackRegistry, releasePluginCallbacks } from "../runtime/plugin-callback-wire";
import { ownPluginViewClose } from "./plugin-view-close";
import { normalizePluginView } from "./plugin-view";
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

function fixture() {
  const registry = new PluginCallbackRegistry();
  const owner = new AbortController();
  const notices: string[] = [];
  let failures = 0;
  const session = new PluginViewSession({ toast: text => notices.push(String(text)), failure: () => { failures++; } });
  const wire = <T,>(value: T): T => decodePluginCallbacks(structuredClone(registry.encode(value)),
    async (handle, args) => wire(await registry.invoke(handle, args)), handles => registry.release(handles), owner.signal) as T;
  const view = (title: string): PluginDetailView => wire({ kind: "detail", title, content: [], actions: [{ id: "run", label: "Run", run: () => ({ toast: title }) }] });
  return { registry, owner, session, view, wire, notices, failures: () => failures };
}

test("table data controls replace pages without growing history and retire old callbacks", async () => {
  const f = fixture();
  const view = (page: number): PluginView => ({ kind: "table",
    columns: [{ id: "name", label: "Name", sortable: true }], rows: [],
    pagination: { page, onNext: () => ({ view: view(page + 1) }) },
    sort: { onChange: () => ({ view: view(1) }) } });
  f.session.setRoot(f.wire(view(1)));
  for (let page = 1; page <= 4; page++) {
    const current = f.session.getSnapshot().stack[0];
    if (current.kind !== "table") throw new Error("Expected table");
    expect(current.pagination?.page).toBe(page);
    await f.session.runFrom(f.session.getSnapshot().renderKey, current.pagination!.onNext!, { navigation: "replace" });
    expect(f.session.getSnapshot().stack).toHaveLength(1);
    expect(f.registry.size).toBe(2);
  }
  const current = f.session.getSnapshot().stack[0];
  if (current.kind !== "table") throw new Error("Expected table");
  await f.session.run(() => current.sort!.onChange({ column: "name", direction: "ascending" }), { navigation: "replace" });
  expect((f.session.getSnapshot().stack[0] as typeof current).pagination?.page).toBe(1);
  // A plugin may deliberately navigate elsewhere rather than replacing data.
  await f.session.run(() => ({ view: f.view("Detail"), navigation: "push" }), { navigation: "replace" });
  expect(f.session.getSnapshot().stack).toHaveLength(2);
  f.session.dispose(); expect(f.registry.size).toBe(0);
});

test("data-control failure retains the current page; a late page after close is discarded", async () => {
  const f = fixture();
  f.session.setRoot(f.wire({ kind: "list", items: [], pagination: { page: 2, onPrevious: () => null } }));
  const key = f.session.getSnapshot().renderKey;
  await f.session.run(() => { throw new AppError("db/locked", "private"); }, { navigation: "replace" });
  expect(f.failures()).toBe(1); expect(f.session.getSnapshot().renderKey).toBe(key);
  expect(f.registry.size).toBe(1);
  let finish!: (value: PluginViewResult) => void;
  const pending = f.session.run(() => new Promise(resolve => { finish = resolve; }), { navigation: "replace" });
  f.session.close();
  finish({ view: f.view("Late page") }); await pending;
  expect(f.registry.size).toBe(0); expect(f.session.getSnapshot().stack).toEqual([]);
});

test("accepted frames report their removal once, not when covered by push or a dialog", async () => {
  const f = fixture(), closed: string[] = [];
  const view = (title: string): PluginView => f.wire({ kind: "markdown", markdown: title,
    onClose: ({ reason }) => { closed.push(`${title}:${reason}`); } });
  f.session.setRoot(view("root"));
  await f.session.run(() => ({ view: view("child") })); await flush(); expect(closed).toEqual([]);
  f.session.back(); await flush(); expect(closed).toEqual(["child:back"]);
  await f.session.run(() => ({ view: view("replace"), navigation: "replace" }));
  await f.session.run(() => ({ view: view("pushed") }));
  await f.session.run(() => ({ view: view("reset"), navigation: "reset" }));
  await f.session.run(() => ({ view: view("dialog") }), { presentation: "dialog" }); await flush();
  expect(closed).toEqual(["child:back", "root:replaced", "replace:reset", "pushed:reset"]);
  f.session.closeDialog(); await flush(); expect(closed.at(-1)).toBe("dialog:closed");
  f.session.close(); f.session.close(); await flush();
  expect(closed.at(-1)).toBe("reset:closed"); expect(closed).toHaveLength(6); expect(f.registry.size).toBe(0);
});

test("StrictMode replay does not close frames; root refresh and real unmount have distinct reasons", async () => {
  const f = fixture(), closed: string[] = [];
  const view = (): PluginView => f.wire({ kind: "markdown", markdown: "root", onClose: ({ reason }) => { closed.push(reason); } });
  const root = view(); f.session.setRoot(root);
  const epoch = f.session.suspend(); f.session.resume(); f.session.setRoot(root); f.session.disposeIfSuspended(epoch);
  await flush(); expect(closed).toEqual([]);
  f.session.setRoot(view()); await flush(); expect(closed).toEqual(["refreshed"]);
  f.session.disposeIfSuspended(f.session.suspend()); await flush(); expect(closed).toEqual(["refreshed", "unmounted"]);
  expect(f.registry.size).toBe(0);
});

test("discarded or retired views are not notified and invalid close declarations fail validation", async () => {
  const f = fixture(); let closed = 0;
  const view = (): PluginView => f.wire({ kind: "markdown", markdown: "view", onClose: () => { closed++; } });
  f.session.setRoot(view());
  await f.session.run(() => ({ view: view(), navigation: "invalid" } as unknown as PluginViewResult));
  let finish!: (result: PluginViewResult) => void;
  const pending = f.session.run(() => new Promise(resolve => { finish = resolve; }));
  f.owner.abort(); finish({ view: view() }); await pending; await flush();
  expect(closed).toBe(0); expect(f.registry.size).toBe(0);
  for (const onClose of [null, false, "callback", {}]) expect(() => normalizePluginView({ kind: "markdown", markdown: "x", onClose })).toThrow();
});

test("close notification does not delay removal and retains only its callback until settlement", async () => {
  const f = fixture(); let finish!: () => void, calls = 0;
  const view = f.wire<PluginView>({ kind: "markdown", markdown: "view", onClose: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  f.session.setRoot(view); f.session.close();
  expect(f.session.getSnapshot().stack).toEqual([]); await flush();
  expect(calls).toBe(1); expect(f.registry.size).toBe(1);
  finish(); await flush(); expect(f.registry.size).toBe(0);
  const callback = f.wire(() => new Promise<void>(() => {}));
  const owned = ownPluginViewClose(callback, 5); owned.notify("closed"); owned.dispose();
  await new Promise(resolve => setTimeout(resolve, 15)); expect(f.registry.size).toBe(0);
});

test("action failures preserve the form and forward stable error codes without raw details", async () => {
  const payloads: unknown[] = [];
  const session = new PluginViewSession();
  session.setRoot({ kind: "detail", title: "Shortcut", content: [] });
  const before = session.getSnapshot().renderKey;
  setPluginToastHandler(payload => payloads.push(payload));
  try {
    await session.run(async () => { throw new AppError("settings/shortcut-conflict", "private payload"); });
    expect(session.getSnapshot().renderKey).toBe(before);
    expect(session.getSnapshot().stack).toHaveLength(1);
    expect(session.getSnapshot().busy).toBe(false);
    expect(payloads).toEqual([{ kind: "failure", pluginName: undefined, code: "settings/shortcut-conflict" }]);
  } finally { session.dispose(); setPluginToastHandler(null); }
});

test("push/back/replace/reset release exactly removed view callbacks", async () => {
  const f = fixture();
  const root = f.view("Root"), child = f.view("Child");
  f.session.setRoot(root);
  await f.session.run(async () => ({ view: child }));
  expect(f.registry.size).toBe(2);
  f.session.back();
  expect(f.registry.size).toBe(1);
  await expect(child.actions![0].run()).rejects.toMatchObject({ code: "plugin/unavailable" });
  await f.session.run(async () => ({ view: f.view("Next") }));
  await f.session.run(async () => ({ view: f.view("Replacement"), navigation: "replace" }));
  expect(f.registry.size).toBe(2);
  await f.session.run(async () => ({ view: f.view("Reset"), navigation: "reset" }));
  expect(f.registry.size).toBe(1);
  expect(f.session.getSnapshot().stack.map(view => view.title)).toEqual(["Reset"]);
  f.session.dispose(); f.session.dispose();
  expect(f.registry.size).toBe(0);
});

test("shared callback aliases survive until the last view owner releases them", async () => {
  const f = fixture();
  const root = f.view("Root");
  f.session.setRoot(root);
  await f.session.run(async () => ({ view: { ...root, title: "Shared child" } }));
  releasePluginCallbacks(root);
  expect(f.registry.size).toBe(1);
  f.session.back();
  expect(await root.actions![0].run()).toEqual({ toast: "Root" });
  f.session.dispose();
  expect(f.registry.size).toBe(0);
});

test("normalization and invalid declarations release unused callback fields", async () => {
  const f = fixture();
  const raw = f.wire({ kind: "detail", content: [], extra: () => 1, actions: [{ id: "run", label: "Run", run: () => null }] });
  f.session.setRoot(raw as PluginDetailView);
  expect(f.registry.size).toBe(1);
  await f.session.run(async () => f.wire({ view: { kind: "unknown", run: () => null }, extra: () => null }) as unknown as PluginViewResult);
  expect(f.registry.size).toBe(1);
  expect(f.failures()).toBe(1);
  await f.session.run(async () => ({ view: f.view("Invalid mode"), navigation: "invalid" } as unknown as PluginViewResult));
  expect(f.registry.size).toBe(1);
  f.session.setRoot(f.wire({ kind: "unknown", run: () => null }) as unknown as PluginDetailView);
  expect(f.session.getSnapshot().error).toBe(true);
  expect(f.registry.size).toBe(0);
});

test("late action results after close cannot navigate, toast or retain callbacks", async () => {
  const f = fixture();
  f.session.setRoot(f.view("Root"));
  let finish!: (value: PluginViewResult) => void;
  const pending = f.session.run(() => new Promise(resolve => { finish = resolve; }));
  f.session.close();
  finish(f.wire({ view: { kind: "detail", content: [], actions: [{ id: "run", label: "Run", run: () => null }] }, toast: "too late" }));
  expect(await pending).toBeNull();
  expect(f.registry.size).toBe(0);
  expect(f.notices).toEqual([]);
  expect(f.session.getSnapshot().stack).toEqual([]);
});

test("new actions supersede old results without an old finally clearing the new busy state", async () => {
  const f = fixture();
  f.session.setRoot(f.view("Root"));
  let first!: (value: PluginViewResult) => void, second!: (value: PluginViewResult) => void;
  const a = f.session.run(() => new Promise(resolve => { first = resolve; }));
  const b = f.session.run(() => new Promise(resolve => { second = resolve; }));
  first({ view: f.view("Old"), toast: "stale" });
  expect(await a).toBeNull();
  expect(f.session.getSnapshot().busy).toBe(true);
  expect(f.registry.size).toBe(1);
  second({ view: f.view("New"), navigation: "replace" });
  await b;
  expect(f.session.getSnapshot().busy).toBe(false);
  expect(f.session.getSnapshot().stack[0].title).toBe("New");
  expect(f.registry.size).toBe(1);
  expect(f.notices).toEqual([]);
  f.session.dispose();
});

test("closed/replaced nested dialogs own their callbacks and reject late modal results", async () => {
  const f = fixture();
  f.session.setRoot(f.view("Root"));
  await f.session.run(async () => ({ view: f.view("Modal") }), { presentation: "dialog" });
  const modal = f.session.getSnapshot().dialog!.session;
  expect(f.registry.size).toBe(2);
  let finish!: (value: PluginViewResult) => void;
  const pending = modal.run(() => new Promise(resolve => { finish = resolve; }));
  f.session.closeDialog();
  finish({ view: f.view("Late modal") });
  expect(await pending).toBeNull();
  expect(f.registry.size).toBe(1);
  const parentPending = f.session.run(() => new Promise(resolve => { finish = resolve; }), { presentation: "dialog" });
  f.session.closeDialog();
  finish({ view: f.view("Late open") });
  expect(await parentPending).toBeNull();
  expect(f.session.getSnapshot().dialog).toBeNull();
  expect(f.registry.size).toBe(1);
  f.session.dispose();
});

test("StrictMode suspension invalidates pending work without destroying callbacks reused by setup", () => {
  const f = fixture();
  const root = f.view("Root");
  f.session.setRoot(root);
  const epoch = f.session.suspend();
  f.session.resume(); f.session.setRoot(root);
  f.session.disposeIfSuspended(epoch);
  expect(f.registry.size).toBe(1);
  f.session.disposeIfSuspended(f.session.suspend());
  expect(f.registry.size).toBe(0);
});

test("repeated view replacement has bounded callback ownership", async () => {
  const f = fixture();
  f.session.setRoot(f.view("Root"));
  for (let i = 0; i < 1_000; i++) {
    await f.session.run(async () => ({ view: f.view(String(i)), navigation: "replace" }));
    expect(f.registry.size).toBe(1);
  }
  f.session.dispose();
  expect(f.registry.size).toBe(0);
});

test("Worker retirement closes owned views, including declarations with no callbacks", () => {
  for (const callbacks of [true, false]) {
    const f = fixture();
    let closed = 0;
    f.session.configure({ close: () => { closed++; } });
    f.session.setRoot(callbacks ? f.view("Root") : f.wire({ kind: "markdown", markdown: "No callbacks" }));
    f.owner.abort();
    expect(f.session.getSnapshot().stack).toEqual([]);
    expect(f.registry.size).toBe(0);
    expect(closed).toBe(1);
  }
});

test("explicit same-depth navigation changes render identity while data refreshes and errors retain it", async () => {
  const f = fixture();
  f.session.setRoot(f.view("Root"));
  const rootKey = f.session.getSnapshot().renderKey;
  f.session.setRoot(f.view("Fresh root data"));
  expect(f.session.getSnapshot().renderKey).toBe(rootKey);
  let finish!: (value: PluginViewResult) => void;
  const pending = f.session.run(() => new Promise(resolve => { finish = resolve; }));
  expect(f.session.getSnapshot().renderKey).toBe(rootKey);
  finish({ fieldErrors: { body: "Conflict" } });
  await pending;
  expect(f.session.getSnapshot().renderKey).toBe(rootKey);
  await f.session.run(async () => ({ view: f.view("Explicit refresh"), navigation: "replace" }));
  const replacement = f.session.getSnapshot().renderKey;
  expect(replacement).not.toBe(rootKey);
  await f.session.run(async () => ({ view: f.view("Reset"), navigation: "reset" }));
  expect(f.session.getSnapshot().renderKey).not.toBe(replacement);
  const parentKey = f.session.getSnapshot().renderKey;
  await f.session.run(async () => ({ view: f.view("Child") }));
  expect(f.session.getSnapshot().renderKey).not.toBe(parentKey);
  f.session.back();
  expect(f.session.getSnapshot().renderKey).toBe(parentKey);
  f.session.dispose();
  expect(f.session.getSnapshot().renderKey).toBeNull();
  expect(f.registry.size).toBe(0);
});
