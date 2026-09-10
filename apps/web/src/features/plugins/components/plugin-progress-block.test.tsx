import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Progress } from "@read-aware/ui";
import { initI18n } from "../../../i18n";
import { PluginBlocks } from "./PluginBlockRenderer";
import type { PluginResultOptions, PluginResultRunner } from "./plugin-view-types";

test("progress keeps cancellation usable during foreground work and never invents an indeterminate percentage", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const options: (PluginResultOptions | undefined)[] = []; let calls = 0, finish!: () => void;
  const onResult: PluginResultRunner = async (run, option) => { options.push(option); return run(); };
  const cancel = { id: "work", label: "Cancel import", run: async () => { calls++; await new Promise<void>(resolve => { finish = resolve; }); } };
  const render = (value: number | null, cancellable = true) => root.render(<StrictMode><PluginBlocks blocks={[
    { kind: "progress", value, max: 10, label: "Importing books", showValue: true, ...(cancellable ? { cancel } : {}) },
  ]} busy stackDepth={0} onResult={onResult} /></StrictMode>);
  try {
    await initI18n("en");
    await act(async () => { render(null); });
    const bar = () => dom.window.document.querySelector('[role="progressbar"]')!;
    expect(bar().hasAttribute("aria-valuenow")).toBe(false);
    expect(bar().getAttribute("aria-busy")).toBe("true");
    expect(dom.window.document.body.textContent).not.toContain("%");
    const button = dom.window.document.querySelector<HTMLButtonElement>('button[aria-label="Cancel import"]')!;
    expect(button.disabled).toBe(false);
    await act(async () => { button.click(); button.click(); });
    expect(calls).toBe(1); expect(button.disabled).toBe(true); expect(options).toEqual([{ background: true }]);
    await act(async () => { render(4); });
    expect(button.disabled).toBe(true); expect(bar().getAttribute("aria-valuenow")).toBe("4");
    expect(dom.window.document.body.textContent).toContain("40%");
    await act(async () => { finish(); }); expect(button.disabled).toBe(false);
    await act(async () => { render(10, false); });
    expect(dom.window.document.querySelector("button")).toBeNull();
    expect(dom.window.document.body.textContent).toContain("100%");
    await act(async () => { root.render(<Progress value={200} max={100} label="Clamped" />); });
    expect(bar().getAttribute("aria-valuenow")).toBe("100");
  } finally {
    await act(async () => { root.unmount(); }); dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
