import { expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppError, type ConnectionTestReceipt } from "@read-aware/core";
import { initI18n } from "../../../i18n";
import { workspace } from "../../../services/workspace";
import { nativeConnectionTest } from "../lib/test-ai-connection";
import { useAIConnectionTest } from "./useAIConnectionTest";
import { useMaintenanceSurface } from "./useMaintenanceSurface";
import { buildPluginContext } from "../../plugins/runtime/plugin-context";

if (process.env.AI_TEST_FLOW_CASE === "1") {
test("native click owns connection inference and actors receive only final statuses", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  let response = "PRIVATE RESPONSE", flushes = 0, canTest = true;
  const calls: unknown[] = [];
  const native = spyOn(nativeConnectionTest, "run").mockImplementation(async config => { calls.push(config); return response; });
  const navigate = spyOn(workspace, "navigate").mockResolvedValue({ status: "completed" } as never);
  const actor = buildPluginContext({ id: "test-flow", name: "Test", version: "1", schemaVersion: 1,
    requires: { services: { maintenance: "^1.3.0" } }, permissions: [] }, "1", []);
  actor.lifecycle.promote();
  let flow!: ReturnType<typeof useAIConnectionTest>;
  function Harness() {
    const ref = useMaintenanceSurface("ai-connection");
    flow = useAIConnectionTest({ provider: "openai", apiKey: "PRIVATE KEY", model: "model" }, canTest, () => { flushes++; });
    return <button ref={ref} onClick={() => void flow.handleTest()}>Test</button>;
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  const tick = () => Bun.sleep(0);
  const request = () => actor.context.services.maintenance.requestConnectionTest();
  try {
    await initI18n("en"); Object.assign(dom.window, { __TAURI_INTERNALS__: {} });
    await act(async () => { root.render(<StrictMode><Harness /></StrictMode>); });
    let pending!: Promise<ConnectionTestReceipt>;
    for (const text of ["PRIVATE RESPONSE", ""]) {
      response = text; const before = calls.length;
      await act(async () => { pending = request(); await tick(); });
      expect(dom.window.document.activeElement?.tagName).toBe("BUTTON");
      expect(calls).toHaveLength(before); expect(flushes).toBe(before);
      await act(async () => { dom.window.document.querySelector("button")!.click(); await tick(); });
      expect(await pending).toEqual({ action: "test", status: text ? "responded" : "empty" });
      expect(calls).toHaveLength(before + 1); expect(flow.isTesting).toBe(false);
    }
    const abort = new AbortController();
    await act(async () => { pending = actor.context.services.maintenance.requestConnectionTest({ signal: abort.signal }); await tick(); });
    const cancelled = pending.catch(error => error);
    await act(async () => { abort.abort(); await cancelled; await tick(); });
    expect(await cancelled).toBeInstanceOf(Error); expect(calls).toHaveLength(2);

    canTest = false;
    await act(async () => { root.render(<StrictMode><Harness /></StrictMode>); pending = request(); await tick(); });
    await act(async () => { await flow.handleTest(); }); expect(calls).toHaveLength(2);
    canTest = true; await act(async () => { root.render(<StrictMode><Harness /></StrictMode>); });
    native.mockRejectedValue(new AppError("ai/network", "PRIVATE FAILURE"));
    const failed = pending.catch(error => error);
    await act(async () => { await flow.handleTest(); });
    expect(await failed).toMatchObject({ code: "ai/network" });
    expect(flow.testResult?.message).not.toContain("PRIVATE");

    const gate = Promise.withResolvers<string>(); native.mockImplementation(() => gate.promise);
    await act(async () => { pending = request(); await tick(); });
    const stale = pending.catch(error => error);
    let running!: Promise<void>;
    await act(async () => { running = flow.handleTest(); await tick(); });
    await act(async () => { flow.resetTest(); gate.resolve("old configuration reply"); await running; });
    expect(await stale).toMatchObject({ code: "ui/superseded" }); expect(flow.testResult).toBeNull();

    await act(async () => { pending = request(); await tick(); });
    await act(async () => { root.unmount(); });
    expect(await pending).toEqual({ action: "test", status: "cancelled" });
    actor.lifecycle.stop(); expect(() => request()).toThrow();
  } finally {
    actor.lifecycle.stop(); native.mockRestore(); navigate.mockRestore(); dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
} else {
  test("isolated mounted AI connection test flow", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, AI_TEST_FLOW_CASE: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
  });
}
