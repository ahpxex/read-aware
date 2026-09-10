import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { PluginDetailView, PluginView } from "../lib/plugin-types";
import type { PluginViewSession } from "../lib/plugin-view-session";
import { usePluginViewSession } from "./usePluginViewSession";
import { usePluginViewSource } from "./usePluginViewSource";
import { decodePluginCallbacks, PluginCallbackRegistry } from "../runtime/plugin-callback-wire";

test("React StrictMode, same-key source replacement, refresh and unmount transfer view ownership", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const registry = new PluginCallbackRegistry();
  const closed: string[] = [];
  const owner = new AbortController();
  const wire = <T,>(value: T): T => decodePluginCallbacks(structuredClone(registry.encode(value)),
    (handle, args) => registry.invoke(handle, args), handles => registry.release(handles), owner.signal) as T;
  const view = (title: string): PluginDetailView => wire({ kind: "detail", title, content: [], actions: [{ id: "run", label: "Run", run: () => null }],
    onClose: ({ reason }: { reason: string }) => { closed.push(`${title}:${reason}`); } });
  type Source = { key: string; load: () => PluginView | Promise<PluginView> };
  let session!: PluginViewSession, refresh!: () => void;
  let failures = 0;
  function Harness({ source }: { source: Source }) {
    const loaded = usePluginViewSource(source, true, source.load, () => { failures++; });
    const rendered = usePluginViewSession(loaded.view, undefined);
    session = rendered.session; refresh = loaded.refresh;
    return createElement("div", null, rendered.stack.at(-1)?.title ?? "loading");
  }
  const render = (source: Source) => root.render(createElement(StrictMode, null, createElement(Harness, { source })));
  try {
    let loads = 0;
    await act(async () => { render({ key: "same", load: () => { loads++; return view("First"); } }); });
    expect(loads).toBe(1);
    expect(dom.window.document.body.textContent).toBe("First");
    expect(registry.size).toBe(2); expect(closed).toEqual([]);
    await act(async () => { await session.run(async () => ({ view: view("Replaced"), navigation: "replace" })); });
    expect(registry.size).toBe(2); expect(closed).toEqual(["First:replaced"]);
    await act(async () => { render({ key: "same", load: () => view("Second") }); });
    expect(dom.window.document.body.textContent).toBe("Second");
    expect(registry.size).toBe(2); expect(closed).toContain("Replaced:unmounted");
    await act(async () => { refresh(); });
    expect(registry.size).toBe(2); expect(closed).toContain("Second:refreshed");
    let finish!: (next: PluginView) => void;
    await act(async () => { render({ key: "same", load: () => new Promise(resolve => { finish = resolve; }) }); });
    await act(async () => { root.unmount(); });
    expect(registry.size).toBe(0);
    await act(async () => { finish(view("Late")); });
    expect(registry.size).toBe(0);
    expect(failures).toBe(0);
    expect(closed).toContain("Second:unmounted"); expect(closed.some(value => value.startsWith("Late:"))).toBe(false);
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
