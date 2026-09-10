import { expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "@read-aware/ui";
import type { BackupReceipt } from "@read-aware/core";
import { initI18n } from "../../../i18n";
import { hostMaintenance } from "../../../services/maintenance";
import { workspace } from "../../../services/workspace";
import { backupFileActions } from "../lib/backup-file-actions";
import { useBackupActions } from "./useBackupActions";
import { buildPluginContext } from "../../plugins/runtime/plugin-context";

if (process.env.BACKUP_HOOK_CASE === "1") {
test("actor backup requests await a real host click, preserve cancellation and return final status only", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let exports = 0, imports = 0, focused = "", saveResult = false;
  const importMock = spyOn(backupFileActions, "import").mockImplementation(async () => { imports++; return null; });
  const mocks = [spyOn(workspace, "navigate").mockResolvedValue({ status: "completed" } as never),
    spyOn(backupFileActions, "export").mockImplementation(async () => { exports++; return saveResult; }),
    importMock];
  const controls = [hostMaintenance.bindSurface("backup-export", () => { focused = "export"; }), hostMaintenance.bindSurface("backup-import", () => { focused = "import"; })];
  const actor = buildPluginContext({ id: "backup-test", name: "Backup", version: "1", schemaVersion: 1,
    requires: { services: { maintenance: "^1.2.0" } }, permissions: [] }, "1", []);
  actor.lifecycle.promote();
  let flow!: ReturnType<typeof useBackupActions>;
  function Harness() { flow = useBackupActions(); return <button onClick={() => void flow.run("export")}>Export</button>; }
  const root = createRoot(dom.window.document.getElementById("root")!);
  const tick = () => Bun.sleep(0);
  try {
    await initI18n("en");
    Object.assign(dom.window, { __TAURI_INTERNALS__: {} });
    await act(async () => { root.render(<StrictMode><ToastProvider><Harness /></ToastProvider></StrictMode>); });
    let request!: Promise<BackupReceipt>;
    for (const save of [false, true]) {
      saveResult = save;
      const before = exports;
      await act(async () => { request = actor.context.services.maintenance.requestBackup("export"); await tick(); });
      expect(focused).toBe("export"); expect(flow.requested).toBe("export"); expect(exports).toBe(before);
      await act(async () => { await flow.run("import"); }); expect(imports).toBe(0);
      await act(async () => { dom.window.document.querySelector("button")!.click(); await tick(); });
      expect(await request).toEqual({ action: "export", status: save ? "exported" : "cancelled" });
      expect(exports).toBe(before + 1); expect(flow.busy).toBe(false);
    }
    await act(async () => { request = actor.context.services.maintenance.requestBackup("import"); await tick(); });
    expect(imports).toBe(0); await act(async () => { await flow.run("import"); });
    expect(await request).toEqual({ action: "import", status: "cancelled" }); expect(imports).toBe(1);
    const signal = new AbortController();
    await act(async () => { request = actor.context.services.maintenance.requestBackup("export", { signal: signal.signal }); await tick(); });
    const rejected = request.catch(error => error);
    await act(async () => { signal.abort(); await rejected; await tick(); });
    expect(flow.requested).toBeNull(); expect(exports).toBe(2);
    importMock.mockResolvedValueOnce({ books: 1, collections: 2, annotations: 3, settings: 4 });
    await act(async () => { request = actor.context.services.maintenance.requestBackup("import"); await tick(); });
    await act(async () => { await flow.run("import"); });
    expect(await request).toEqual({ action: "import", status: "imported" }); expect(flow.busy).toBe(true);
    await act(async () => { actor.lifecycle.stop(); });
    expect(() => actor.context.services.maintenance.requestBackup("export")).toThrow();
  } finally {
    actor.lifecycle.stop(); await act(async () => { root.unmount(); });
    controls.forEach(off => off()); mocks.forEach(mock => mock.mockRestore()); dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
} else {
  test("isolated mounted backup action contract", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], { env: { ...process.env, BACKUP_HOOK_CASE: "1" }, stdout: "ignore", stderr: "pipe" });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("1 pass");
  }, 30_000);
}
