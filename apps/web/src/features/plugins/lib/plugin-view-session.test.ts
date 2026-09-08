import { expect, test } from "bun:test";
import type { PluginDetailView, PluginViewResult } from "./plugin-types";
import { PluginViewSession } from "./plugin-view-session";
import { decodePluginCallbacks, PluginCallbackRegistry, releasePluginCallbacks } from "../runtime/plugin-callback-wire";

function fixture() {
  const registry = new PluginCallbackRegistry();
  const owner = new AbortController();
  const notices: string[] = [];
  let failures = 0;
  const session = new PluginViewSession({ toast: text => notices.push(text), failure: () => { failures++; } });
  const wire = <T,>(value: T): T => decodePluginCallbacks(structuredClone(registry.encode(value)),
    async (handle, args) => wire(await registry.invoke(handle, args)), handles => registry.release(handles), owner.signal) as T;
  const view = (title: string): PluginDetailView => wire({ kind: "detail", title, content: [], actions: [{ id: "run", label: "Run", run: () => ({ toast: title }) }] });
  return { registry, owner, session, view, wire, notices, failures: () => failures };
}

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
