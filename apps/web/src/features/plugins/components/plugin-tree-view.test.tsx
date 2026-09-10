import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initI18n } from "../../../i18n";
import type { PluginTreeView } from "../lib/plugin-types";
import { PluginTreeViewBody } from "./PluginTreeViewBody";
import type { PluginResultOptions, PluginResultRunner } from "./plugin-view-types";

test("mounted tree supports disclosure, roving keyboard focus, typeahead, callbacks and live node removal", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div><button id='outside'>Outside</button>");
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const calls: unknown[] = [], options: (PluginResultOptions | undefined)[] = [];
  const onResult: PluginResultRunner = async (run, option) => { options.push(option); return run(); };
  const view: PluginTreeView = { kind: "tree", title: "Contents", nodes: [
    { id: "part", title: "Part one", children: [
      { id: "chapter", title: "Chapter one", children: [{ id: "passage", title: "<b>Passage</b>", presentation: "dialog", onSelect: () => { calls.push("open"); } }] },
      { id: "appendix", title: "Appendix" },
    ] },
    { id: "end", title: "End" },
  ], pagination: { page: 2, onPrevious: () => { calls.push("previous"); } } };
  const item = (label: string) => dom.window.document.querySelector<HTMLDivElement>(`[role=treeitem][aria-label="${label}"]`)!;
  const labels = () => [...dom.window.document.querySelectorAll("[role=treeitem]")].map(item => item.getAttribute("aria-label"));
  const key = async (key: string) => { await act(async () => {
    dom.window.document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }); };
  const focused = () => dom.window.document.activeElement?.getAttribute("aria-label");
  const render = async (next = view, busy = false) => { await act(async () => {
    root.render(<StrictMode><PluginTreeViewBody view={next} busy={busy} onResult={onResult} /></StrictMode>);
  }); };
  try {
    await initI18n("en"); await render();
    expect(labels()).toEqual(["Part one", "End"]);
    expect(dom.window.document.querySelectorAll("[role=treeitem][tabindex='0']")).toHaveLength(1);
    await act(async () => { item("Part one").focus(); });
    await key("ArrowRight"); expect(item("Part one").getAttribute("aria-expanded")).toBe("true");
    expect(focused()).toBe("Part one");
    await key("ArrowRight"); expect(focused()).toBe("Chapter one");
    await key("ArrowRight"); await key("ArrowRight"); expect(focused()).toBe("<b>Passage</b>");
    expect(item("<b>Passage</b>").getAttribute("aria-level")).toBe("3");
    expect(item("Chapter one").getAttribute("aria-setsize")).toBe("2");
    expect(dom.window.document.querySelector("[role=tree] b")).toBeNull();
    expect(calls).toEqual([]);
    await key("Enter"); expect(calls).toEqual(["open"]);
    expect(options[0]).toEqual({ presentation: "dialog", dialogTitle: "<b>Passage</b>" });
    await key("ArrowLeft"); expect(focused()).toBe("Chapter one");
    await key("ArrowLeft"); expect(item("Chapter one").getAttribute("aria-expanded")).toBe("false");
    await key("a"); expect(focused()).toBe("Appendix");
    await key("Home"); expect(focused()).toBe("Part one");
    await key("End"); expect(focused()).toBe("End");
    await key("ArrowUp"); expect(focused()).toBe("Appendix");
    await key("ArrowLeft"); expect(focused()).toBe("Part one");
    await key("ArrowDown"); await key("*");
    expect(item("Chapter one").getAttribute("aria-expanded")).toBe("true");
    await key("ArrowRight"); expect(focused()).toBe("<b>Passage</b>");
    const removed = { ...view, nodes: [{ ...view.nodes[0], children: [{ id: "chapter", title: "Chapter one" }] }, view.nodes[1]] };
    await render(removed); expect(focused()).toBe("Chapter one");
    expect(item("Part one").getAttribute("aria-expanded")).toBe("true");
    await render(view); expect(item("Chapter one").getAttribute("aria-expanded")).toBe("false");
    await render(view, true);
    await key("ArrowRight"); expect(item("Chapter one").getAttribute("aria-expanded")).toBe("false");
    expect([...dom.window.document.querySelectorAll("button")].filter(button => button.id !== "outside").every(button => button.disabled)).toBe(true);
    await render();
    await act(async () => { dom.window.document.querySelector<HTMLButtonElement>('button[aria-label="Collapse Part one"]')!.click(); });
    expect(labels()).toEqual(["Part one", "End"]); expect(focused()).toBe("Part one");
    await act(async () => { dom.window.document.getElementById("outside")!.focus(); });
    await render({ ...view, nodes: [view.nodes[1]] });
    expect(dom.window.document.activeElement?.id).toBe("outside");
    await render({ ...view, nodes: [] });
    expect(dom.window.document.body.textContent).toContain("Nothing here yet");
    await act(async () => { dom.window.document.querySelector<HTMLButtonElement>('button[aria-label="Previous page"]')!.click(); });
    expect(calls.at(-1)).toBe("previous"); expect(options.at(-1)).toEqual({ navigation: "replace" });
  } finally {
    await act(async () => { root.unmount(); }); dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
