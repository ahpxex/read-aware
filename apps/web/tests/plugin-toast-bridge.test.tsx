import { expect, test } from "bun:test";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { ToastProvider, useToast } from "@read-aware/ui";
import { PluginToastBridge } from "../src/features/plugins/components/PluginToastBridge";
import { initI18n } from "../src/i18n";
import { setPluginToastHandler, showPluginToast } from "../src/features/plugins/lib/plugin-toast";

test("mounted toast bridge localizes errors, gates retry and cleans up manual/timeout/unmount paths", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  let toast!: ReturnType<typeof useToast>["toast"], retries = 0, dismissed = 0;
  function Access() { toast = useToast().toast; return <PluginToastBridge />; }
  try {
    await initI18n("en");
    await act(async () => root.render(<StrictMode><ToastProvider><Access /></ToastProvider></StrictMode>));
    await act(async () => showPluginToast({ kind: "error", code: "db/locked", retry: () => { retries++; } }));
    expect(dom.window.document.body.textContent).toContain("The local database is busy");
    const retry = [...dom.window.document.querySelectorAll("button")].find(button => button.textContent === "Try again")!;
    expect(retry).toBeDefined(); await act(async () => { retry.click(); retry.click(); }); expect(retries).toBe(1);
    await act(async () => showPluginToast({ kind: "error", code: "fs/not-found", retry: () => { retries++; } }));
    expect(dom.window.document.body.textContent).not.toContain("Try again");
    await act(async () => (dom.window.document.querySelector('[aria-label="Dismiss"]') as HTMLButtonElement).click());
    expect(dom.window.document.querySelectorAll('[role="status"]')).toHaveLength(0);
    await act(async () => { toast({ description: "Expires", duration: 5, onDismiss: () => { dismissed++; } }); await new Promise(resolve => setTimeout(resolve, 15)); });
    expect(dismissed).toBe(1);
    await act(async () => { toast({ description: "Unmounts", duration: 0, onDismiss: () => { dismissed++; } }); });
    await act(async () => root.unmount()); expect(dismissed).toBe(2);
  } finally {
    await act(async () => root.unmount()); setPluginToastHandler(null); dom.window.close();
    for (const [key, value] of saved) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
  }
});
