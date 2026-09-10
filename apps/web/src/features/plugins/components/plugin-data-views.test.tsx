import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initI18n } from "../../../i18n";
import type { PluginTableView } from "../lib/plugin-types";
import { PluginTableViewBody } from "./PluginTableViewBody";
import { PluginListViewBody } from "./PluginListViewBody";
import type { PluginResultOptions, PluginResultRunner } from "./plugin-view-types";

test("mounted table exposes semantic sorting, row commands, busy controls and recoverable empty pagination", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const calls: unknown[] = [], options: (PluginResultOptions | undefined)[] = [];
  const onResult: PluginResultRunner = async (run, option) => { options.push(option); return run(); };
  const view: PluginTableView = { kind: "table", title: "Reading time",
    columns: [{ id: "title", label: "Book", sortable: true }, { id: "time", label: "Minutes", align: "end" }],
    rows: [{ id: "one", label: "Book one", cells: { title: "<b>Book one</b>", time: 15 }, presentation: "dialog", onSelect: () => { calls.push("open"); } }],
    sort: { value: { column: "title", direction: "ascending" }, onChange: sort => { calls.push(sort); } },
    pagination: { page: 2, pageCount: 2, onPrevious: () => { calls.push("previous"); } } };
  const button = (label: string) => dom.window.document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  try {
    await initI18n("en");
    await act(async () => { root.render(<StrictMode><PluginTableViewBody view={view} busy={false} onResult={onResult} /></StrictMode>); });
    expect(dom.window.document.querySelector("th[aria-sort=ascending]")?.textContent).toBe("Book");
    expect(dom.window.document.querySelector("tbody b")).toBeNull();
    expect(dom.window.document.querySelector("td")?.textContent).toBe("<b>Book one</b>");
    expect(button("Next page").disabled).toBe(true);
    const previousTip = dom.window.document.getElementById(button("Previous page").getAttribute("aria-describedby")!);
    const nextTip = dom.window.document.getElementById(button("Next page").getAttribute("aria-describedby")!);
    expect(previousTip?.classList.contains("left-0")).toBe(true);
    expect(nextTip?.classList.contains("right-0")).toBe(true);
    await act(async () => { dom.window.document.querySelector<HTMLButtonElement>("th button")!.click(); });
    await act(async () => { button("Open Book one").click(); button("Previous page").click(); });
    expect(calls).toEqual([{ column: "title", direction: "descending" }, "open", "previous"]);
    expect(options).toEqual([{ navigation: "replace" }, { presentation: "dialog", dialogTitle: "Book one" }, { navigation: "replace" }]);
    await act(async () => { root.render(<PluginTableViewBody view={view} busy onResult={onResult} />); });
    expect([...dom.window.document.querySelectorAll("button")].every(button => button.disabled)).toBe(true);
    await act(async () => { root.render(<PluginTableViewBody view={{ ...view, rows: [] }} busy={false} onResult={onResult} />); });
    expect(dom.window.document.body.textContent).toContain("Nothing here yet");
    expect(button("Previous page").disabled).toBe(false);
    await act(async () => { root.render(<PluginListViewBody view={{ kind: "list", items: [], pagination: view.pagination }} busy={false} onResult={onResult} />); });
    expect(dom.window.document.body.textContent).toContain("Page 2 of 2");
    await act(async () => { button("Previous page").click(); });
    expect(calls.at(-1)).toBe("previous");
  } finally {
    await act(async () => { root.unmount(); }); dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
