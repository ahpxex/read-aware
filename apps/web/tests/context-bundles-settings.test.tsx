import { expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "@read-aware/ui";
import { AppError, createContextBundle, type ContextBundle, type ContextBundleSelector } from "@read-aware/core";
import { initI18n } from "../src/i18n";
import { contextBundleSettingsHost, useContextBundles } from "../src/features/settings/hooks/useContextBundles";
import { ContextBundlesGroup } from "../src/features/settings/sections/ContextBundlesGroup";
import type { ResourceOwner } from "../src/services/resource-owner";

if (process.env.CONTEXT_BUNDLE_SETTINGS_CASE === "1") {
  function environment() {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
    const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
      localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
    const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    dom.window.HTMLElement.prototype.scrollIntoView = () => {};
    const calls: { op: string; args: unknown }[] = [], archive = new Map<string, ContextBundle[]>();
    const controls = { supported: true, captureFailure: null as Error | null, saveResult: true, saveFailure: null as Error | null,
      historyGate: null as Promise<void> | null, saveGate: null as Promise<void> | null, disposed: 0, released: [] as string[] };
    const key = (selector: ContextBundleSelector) => JSON.stringify([selector.kind, selector.scope]);
    const owner = {
      save: async (id: string, _name: string | undefined, signal?: AbortSignal) => {
        calls.push({ op: "save", args: id }); if (controls.saveGate) await controls.saveGate; signal?.throwIfAborted();
        if (controls.saveFailure) throw controls.saveFailure; return { saved: controls.saveResult };
      },
      release: async (id: string) => { controls.released.push(id); },
      dispose: async () => { controls.disposed++; },
    } as unknown as ResourceOwner;
    const spies = [
      spyOn(contextBundleSettingsHost, "supported").mockImplementation(() => controls.supported),
      spyOn(contextBundleSettingsHost, "books").mockImplementation(async () => { calls.push({ op: "books", args: null }); return [{ id: "b1", title: "The Locked Room" }]; }),
      spyOn(contextBundleSettingsHost, "threads").mockImplementation(async () => { calls.push({ op: "threads", args: null }); return [{ id: "t1", title: "Plans" }, { id: "t2" }]; }),
      spyOn(contextBundleSettingsHost, "capture").mockImplementation(async (selector, signal) => {
        calls.push({ op: "capture", args: structuredClone(selector) }); signal.throwIfAborted();
        if (controls.captureFailure) throw controls.captureFailure;
        const bundle = await createContextBundle({ format: "readaware.context", schemaVersion: 1, recipeVersion: 1, kind: selector.kind, scope: selector.scope,
          sourceRevision: "test:stable", items: selector.kind === "user_profile_context"
            ? [{ kind: "curated_profile", id: "p", revision: "r", label: "Profile", text: "Reads slowly." }] : [],
          omissions: selector.kind === "book_memory_context" ? [{ kind: "memory", reason: "spoiler", count: 2 }] : [] });
        const rows = archive.get(key(selector)) ?? [];
        const changed = !rows.some(row => row.version === bundle.version);
        if (changed) { rows.push(bundle); archive.set(key(selector), rows); }
        return { bundle, changed, persistence: "event-log" as const };
      }),
      spyOn(contextBundleSettingsHost, "history").mockImplementation(async (query, signal) => {
        calls.push({ op: "history", args: structuredClone(query) }); if (controls.historyGate) await controls.historyGate; signal.throwIfAborted();
        const rows = [...(archive.get(key(query)) ?? [])].reverse();
        return { selector: { kind: query.kind, scope: query.scope }, items: rows.map((row, index) => ({ version: row.version, publishedAt: `2026-09-11T0${rows.length - index}:00:00.000Z` })),
          offset: 0, nextOffset: null, total: rows.length, revision: `cbhist1:${"a".repeat(64)}` };
      }),
      spyOn(contextBundleSettingsHost, "export").mockImplementation(async (query, target, signal) => {
        calls.push({ op: "export", args: structuredClone(query) }); expect(target).toBe(owner); signal.throwIfAborted();
        const row = (archive.get(key(query)) ?? []).find(row => row.version === query.version);
        if (!row) throw new AppError("fs/not-found", "PRIVATE MISSING VERSION");
        return { id: `ref-${query.version.slice(4, 8)}`, name: `${query.kind}-${query.version.slice(4)}.json`, mimeType: "application/json", size: 1, state: "ready", source: "context", expiresAt: 1 };
      }),
      spyOn(contextBundleSettingsHost, "createOwner").mockImplementation(() => owner),
    ];
    return { dom, calls, controls, archive, close: () => {
      for (const spy of spies) spy.mockRestore();
      dom.window.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
      }
    } };
  }
  const tick = () => Bun.sleep(0);

  test("the hook resolves scopes per recipe, publishes through the shared gate and reloads history with honest toasts", async () => {
    const f = environment();
    let flow!: ReturnType<typeof useContextBundles>;
    function Harness() { flow = useContextBundles(); return null; }
    const root = createRoot(f.dom.window.document.getElementById("root")!);
    const body = () => f.dom.window.document.body.textContent ?? "";
    try {
      await initI18n("en");
      await act(async () => { root.render(<StrictMode><ToastProvider><Harness /></ToastProvider></StrictMode>); await tick(); });
      expect(flow.supported).toBe(true); expect(flow.recipe).toBe("user_profile_context"); expect(flow.scope).toBe("user");
      expect(flow.choices.map(choice => choice.value)).toEqual(["user"]);
      expect(flow.history).toMatchObject({ status: "ready", page: { total: 0 } });
      expect(f.calls.filter(call => call.op === "history").at(-1)!.args).toEqual({ kind: "user_profile_context", scope: { kind: "user" }, limit: 20 });

      await act(async () => { await flow.capture(); await tick(); });
      expect(body()).toContain("Published version"); expect(body()).toContain("1 items, 0 omitted");
      expect(flow.history).toMatchObject({ status: "ready", page: { total: 1 } });
      await act(async () => { await flow.capture(); await tick(); });
      expect(body()).toContain("Content unchanged");
      expect(f.calls.filter(call => call.op === "capture")).toHaveLength(2);

      await act(async () => { flow.setRecipe("book_memory_context"); await tick(); });
      expect(flow.scope).toBe("book:b1"); expect(flow.selector).toEqual({ kind: "book_memory_context", scope: { kind: "book", id: "b1" } });
      await act(async () => { await flow.capture(); await tick(); });
      expect(body()).toContain("0 items, 2 omitted");
      await act(async () => { flow.setRecipe("conversation_insights_context"); await tick(); });
      expect(flow.choices.map(choice => choice.value)).toEqual(["book:b1", "conversation:t1", "conversation:t2"]);
      expect(flow.scope).toBe("book:b1");
      await act(async () => { flow.setScope("conversation:t2"); await tick(); });
      expect(flow.selector).toEqual({ kind: "conversation_insights_context", scope: { kind: "conversation", id: "t2" } });
      await act(async () => { flow.setRecipe("reading_intent_context"); await tick(); });
      expect(flow.scope).toBe("user"); expect(flow.choices.map(choice => choice.value)).toEqual(["user", "book:b1"]);
      await act(async () => { flow.setScope("book:b1"); flow.setRecipe("user_profile_context"); await tick(); });
      expect(flow.scope).toBe("user");

      f.controls.captureFailure = new AppError("memory/forbidden", "PRIVATE FAILURE DETAIL");
      await act(async () => { await flow.capture(); await tick(); });
      expect(body()).not.toContain("PRIVATE FAILURE DETAIL"); expect(flow.busy).toBeNull();
      expect(f.dom.window.document.querySelectorAll("[role=status], [role=alert]").length).toBeGreaterThan(0);
      f.controls.captureFailure = null;

      const gate = Promise.withResolvers<void>(); f.controls.historyGate = gate.promise;
      await act(async () => { flow.retry(); await tick(); });
      expect(flow.history.status).toBe("loading");
      await act(async () => { root.unmount(); gate.resolve(); await tick(); });
      expect(f.controls.disposed).toBe(0);
    } finally { f.close(); }
  });

  test("saving exports the pinned version into one host-owned handle, releases it on every outcome and never leaks raw errors", async () => {
    const f = environment();
    let flow!: ReturnType<typeof useContextBundles>;
    function Harness() { flow = useContextBundles(); return null; }
    const root = createRoot(f.dom.window.document.getElementById("root")!);
    const body = () => f.dom.window.document.body.textContent ?? "";
    try {
      await initI18n("en");
      await act(async () => { root.render(<ToastProvider><Harness /></ToastProvider>); await tick(); });
      await act(async () => { await flow.capture(); await tick(); });
      const version = (flow.history as { page: { items: { version: string }[] } }).page.items[0]!.version;
      await act(async () => { await flow.save(version); await tick(); });
      expect(f.calls.filter(call => call.op === "export").at(-1)!.args).toEqual({ kind: "user_profile_context", scope: { kind: "user" }, version });
      expect(f.calls.filter(call => call.op === "save")).toHaveLength(1);
      expect(f.controls.released).toEqual([`ref-${version.slice(4, 8)}`]);
      expect(body()).toContain(`Saved user_profile_context-${version.slice(4)}.json.`);

      f.controls.saveResult = false;
      await act(async () => { await flow.save(version); await tick(); });
      expect(f.controls.released).toHaveLength(2);
      expect(body().match(/Saved user_profile_context/g)).toHaveLength(1);

      f.controls.saveFailure = new AppError("fs/permission", "PRIVATE WRITE ERROR");
      await act(async () => { await flow.save(version); await tick(); });
      expect(f.controls.released).toHaveLength(3); expect(body()).not.toContain("PRIVATE WRITE ERROR");
      expect(body()).toContain("permission"); f.controls.saveFailure = null;
      f.controls.saveFailure = new Error("PRIVATE UNKNOWN ERROR");
      await act(async () => { await flow.save(version); await tick(); });
      expect(f.controls.released).toHaveLength(4); expect(body()).not.toContain("PRIVATE UNKNOWN ERROR");
      expect(body()).toContain("Could not save the context bundle."); f.controls.saveFailure = null;

      await act(async () => { await flow.save(`cb1:${"0".repeat(64)}`); await tick(); });
      expect(f.controls.released).toHaveLength(4); expect(body()).not.toContain("PRIVATE MISSING VERSION");

      const gate = Promise.withResolvers<void>(); f.controls.saveGate = gate.promise;
      await act(async () => { flow.save(version); flow.save(version); flow.capture(); await tick(); });
      expect(flow.busy).toBe(`save:${version}`); expect(f.calls.filter(call => call.op === "save")).toHaveLength(5);
      expect(f.calls.filter(call => call.op === "capture")).toHaveLength(1);
      await act(async () => { root.unmount(); gate.resolve(); await tick(); });
      expect(f.controls.released).toHaveLength(5); expect(f.controls.disposed).toBe(1);
    } finally { f.close(); }
  });

  test("the settings group renders recipes, scopes and versions, and hides native actions outside the desktop app", async () => {
    const f = environment();
    const root = createRoot(f.dom.window.document.getElementById("root")!);
    const body = () => f.dom.window.document.body.textContent ?? "";
    try {
      await initI18n("en");
      await act(async () => { root.render(<StrictMode><ToastProvider><ContextBundlesGroup /></ToastProvider></StrictMode>); await tick(); });
      expect(body()).toContain("Context bundles"); expect(body()).toContain("No versions yet.");
      const capture = [...f.dom.window.document.querySelectorAll("button")].find(button => button.textContent === "Capture")!;
      expect(capture.disabled).toBe(false);
      await act(async () => { capture.click(); await tick(); });
      expect(f.dom.window.document.querySelector("ul[aria-label=Versions]")!.querySelectorAll("li")).toHaveLength(1);
      const save = [...f.dom.window.document.querySelectorAll("button")].find(button => button.textContent === "Save…")!;
      await act(async () => { save.click(); await tick(); });
      expect(f.calls.filter(call => call.op === "save")).toHaveLength(1);
      expect(body()).not.toContain("cb1:");
      await act(async () => { root.unmount(); });
      f.controls.supported = false; f.calls.length = 0;
      const second = createRoot(f.dom.window.document.getElementById("root")!);
      await act(async () => { second.render(<ToastProvider><ContextBundlesGroup /></ToastProvider>); await tick(); });
      expect(body()).toContain("Context bundles are available in the desktop app.");
      expect([...f.dom.window.document.querySelectorAll("button")].find(button => button.textContent === "Capture")!.disabled).toBe(true);
      expect(f.calls).toHaveLength(0);
      await act(async () => { second.unmount(); });
    } finally { f.close(); }
  });
} else {
  test("isolated context bundle settings hook and group contracts", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, CONTEXT_BUNDLE_SETTINGS_CASE: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("3 pass");
  }, 30_000);
}
