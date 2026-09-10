import { expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "@read-aware/ui";
import type { DiagnosticsReportReceipt } from "@read-aware/core";
import { initI18n } from "../../../i18n";
import { hostDiagnosticsFlows } from "../../../services/diagnostics";
import { workspace } from "../../../services/workspace";
import * as diagnostics from "../lib/diagnostics";
import { useDiagnosticsReport } from "./useDiagnosticsReport";

if (process.env.DIAGNOSTIC_REPORT_HOOK_CASE === "1") {
test("mounted report flow never exports/sends before preview confirmation and returns only final status", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const bundle: diagnostics.DiagnosticsBundle = { generatedAt: "2026-09-11", appVersion: "1", platform: "test", language: "en", userAgent: "private",
    logs: [{ name: "private.log", modifiedMs: 0, text: "PRIVATE LOG", truncated: false }], projections: { consistent: true, eventsReplayed: 0, drift: [] } };
  let exports = 0, sends = 0, savedFile = false;
  const assemble = spyOn(diagnostics, "assembleDiagnosticsBundle").mockResolvedValue(bundle);
  const mocks = [assemble,
    spyOn(workspace, "navigate").mockResolvedValue({ status: "completed" } as never),
    spyOn(diagnostics, "exportDiagnosticsBundle").mockImplementation(async value => { expect(value).toBe(bundle); exports++; return savedFile; }),
    spyOn(diagnostics, "sendDiagnosticsReport").mockImplementation(async value => { expect(value).toBe(bundle); sends++; return "PRIVATE REPORT ID"; }),
  ];
  let flow!: ReturnType<typeof useDiagnosticsReport>;
  function Harness() { flow = useDiagnosticsReport(); return null; }
  const root = createRoot(dom.window.document.getElementById("root")!);
  const tick = () => Bun.sleep(0);
  try {
    await initI18n("en");
    await act(async () => { root.render(<StrictMode><ToastProvider><Harness /></ToastProvider></StrictMode>); });
    let request!: Promise<DiagnosticsReportReceipt>;
    await act(async () => { request = hostDiagnosticsFlows.request({ action: "send" }); await tick(); });
    expect(flow.report?.step).toBe("preview"); expect(sends).toBe(0); expect(exports).toBe(0);
    await act(async () => { flow.close(); });
    expect(await request).toEqual({ action: "send", status: "cancelled" });
    for (const saved of [false, true]) {
      savedFile = saved;
      await act(async () => { request = hostDiagnosticsFlows.request({ action: "export" }); await tick(); });
      expect(flow.report?.step).toBe("preview");
      await act(async () => { await flow.confirm(); });
      expect(await request).toEqual({ action: "export", status: saved ? "exported" : "cancelled" });
      expect(flow.report).toBeNull();
    }
    await act(async () => { request = hostDiagnosticsFlows.request({ action: "send" }); await tick(); });
    await act(async () => { await flow.confirm(); });
    expect(await request).toEqual({ action: "send", status: "sent" });
    expect(flow.report).toEqual({ action: "send", step: "sent", reportId: "PRIVATE REPORT ID" });
    expect(sends).toBe(1); expect(exports).toBe(2);
    await act(async () => { flow.close(); });

    const pending = Promise.withResolvers<diagnostics.DiagnosticsBundle>();
    assemble.mockReturnValueOnce(pending.promise);
    const caller = new AbortController();
    await act(async () => { request = hostDiagnosticsFlows.request({ action: "send" }, caller.signal); await tick(); });
    expect(flow.report?.step).toBe("assembling");
    const rejected = request.catch(error => error);
    await act(async () => { caller.abort(Error("cancel assembly")); await rejected; });
    await act(async () => { pending.resolve(bundle); await tick(); });
    expect(flow.report).toBeNull(); expect(sends).toBe(1);
  } finally {
    await act(async () => { root.unmount(); });
    for (const mock of mocks) mock.mockRestore(); dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
} else {
  test("isolated mounted diagnostic preview contract", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, DIAGNOSTIC_REPORT_HOOK_CASE: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("1 pass");
  }, 30_000);
}
