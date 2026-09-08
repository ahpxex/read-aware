import { afterEach, describe, expect, test } from "bun:test";
import { getDefaultStore } from "jotai";
import type { PluginView, PluginViewResult } from "./plugin-types";
import { decodePluginCallbacks, PluginCallbackRegistry } from "../runtime/plugin-callback-wire";
import { setPluginToastHandler } from "./plugin-toast";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

const { runPluginContribution } = await import("./run-result");
const { closePluginDialog, openPluginDialog, pluginDialogAtom } = await import("../state/plugin-store");
const store = getDefaultStore();

afterEach(() => {
  store.set(pluginDialogAtom, null);
  setPluginToastHandler(null);
});

describe("runPluginContribution", () => {
  test("a retired non-dialog contribution cannot emit a late failure toast", async () => {
    const owner = new AbortController();
    const registry = new PluginCallbackRegistry();
    const notices: unknown[] = [];
    setPluginToastHandler(value => notices.push(value));
    let fail!: (reason: unknown) => void;
    const run = decodePluginCallbacks(registry.encode(() => new Promise((_, reject) => { fail = reject; })),
      (handle, args) => registry.invoke(handle, args), undefined, owner.signal) as () => Promise<PluginViewResult>;
    const pending = runPluginContribution("retired", "Retired", run);
    owner.abort();
    fail(new Error("Worker stopped"));
    await pending;
    expect(notices).toEqual([]);
    expect(store.get(pluginDialogAtom)).toBeNull();
  });

  test("closed pending dialog releases late callback graphs without showing their toast", async () => {
    const registry = new PluginCallbackRegistry();
    const notices: unknown[] = [];
    setPluginToastHandler(value => notices.push(value));
    let finish!: (result: PluginViewResult) => void;
    const completion = runPluginContribution("late", "Late", () => new Promise(resolve => { finish = resolve; }), { presentation: "dialog" });
    closePluginDialog(store.get(pluginDialogAtom)!.requestId);
    const wire = registry.encode({ view: { kind: "detail", content: [], actions: [{ id: "run", label: "Run", run: () => null }] }, toast: "late" });
    finish(decodePluginCallbacks(wire, (handle, args) => registry.invoke(handle, args), handles => registry.release(handles)) as PluginViewResult);
    await completion;
    expect(registry.size).toBe(0);
    expect(notices).toEqual([]);
  });

  test("dialog owns unrendered results and only its own Worker generation can close it", async () => {
    const registry = new PluginCallbackRegistry();
    const first = new AbortController(), second = new AbortController();
    const view = (owner: AbortSignal) => decodePluginCallbacks(registry.encode({ kind: "detail", content: [], actions: [{ id: "run", label: "Run", run: () => null }] }),
      (handle, args) => registry.invoke(handle, args), handles => registry.release(handles), owner) as PluginView;
    openPluginDialog({ pluginId: "same", pluginName: "Same", view: view(first.signal)! });
    const next = openPluginDialog({ pluginId: "same", pluginName: "Same", view: view(second.signal)! });
    expect(registry.size).toBe(1);
    first.abort();
    expect(store.get(pluginDialogAtom)?.requestId).toBe(next);
    second.abort();
    expect(store.get(pluginDialogAtom)).toBeNull();
    expect(registry.size).toBe(0);
  });

  test("a pending dialog follows its registered callback owner even before a view exists", async () => {
    const owner = new AbortController();
    const registry = new PluginCallbackRegistry();
    let finish!: (value: PluginViewResult) => void;
    const run = decodePluginCallbacks(registry.encode(() => new Promise(resolve => { finish = resolve; })),
      (handle, args) => registry.invoke(handle, args), undefined, owner.signal) as () => Promise<PluginViewResult>;
    const pending = runPluginContribution("pending", "Pending", run, { presentation: "dialog" });
    owner.abort();
    expect(store.get(pluginDialogAtom)).toBeNull();
    finish(null);
    await pending;
  });
  test("opens a pending Dialog before an async view resolves", async () => {
    let finish!: (result: PluginViewResult) => void;
    const completion = runPluginContribution(
      "dictionary",
      "Dictionary",
      () => new Promise((resolve) => { finish = resolve; }),
      { presentation: "dialog" },
    );

    const pending = store.get(pluginDialogAtom);
    expect(pending?.pluginId).toBe("dictionary");
    expect(pending?.view).toBeNull();

    const view = { kind: "markdown" as const, markdown: "Ready" };
    finish({ view });
    await completion;

    const resolved = store.get(pluginDialogAtom);
    expect(resolved?.requestId).toBe(pending?.requestId);
    expect(resolved?.view).toEqual(view);
  });

  test("does not reopen a Dialog that was closed while loading", async () => {
    let finish!: (result: PluginViewResult) => void;
    const completion = runPluginContribution(
      "dictionary",
      "Dictionary",
      () => new Promise((resolve) => { finish = resolve; }),
      { presentation: "dialog" },
    );

    const pending = store.get(pluginDialogAtom);
    if (!pending) throw new Error("expected pending dialog");
    closePluginDialog(pending.requestId);
    finish({ view: { kind: "markdown", markdown: "Too late" } });
    await completion;

    expect(store.get(pluginDialogAtom)).toBeNull();
  });
});
