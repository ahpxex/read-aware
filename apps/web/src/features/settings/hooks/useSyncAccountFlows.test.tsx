import { expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "@read-aware/ui";
import type { HostSyncFlowReceipt } from "@read-aware/core";
import { initI18n } from "../../../i18n";
import * as scheduler from "../../../platform/sync/sync-scheduler";
import * as external from "../../../platform/external-link";
import { hostSyncFlows } from "../../../services/sync";
import { workspace } from "../../../services/workspace";
import { snapshot } from "../../sync/components/sync.fixtures";
import { useSyncAccountFlows } from "./useSyncAccountFlows";
import type { useSyncConnection } from "./useSyncConnection";

if (process.env.SYNC_FLOW_HOOK_CASE === "1") {
test("mounted settings connects flow requests to existing confirmation callbacks and browser handoff", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let status = snapshot({ accountConnected: false, backend: null }), deletes = 0, connects = 0;
  const urls: string[] = [];
  const mocks = [
    spyOn(workspace, "navigate").mockResolvedValue({ status: "completed" } as never),
    spyOn(scheduler, "getSyncStatusSnapshot").mockImplementation(() => status),
    spyOn(scheduler, "syncRelayClient").mockReturnValue({
      account: async () => ({ tier: "free", hasBilling: true }),
      createPortal: async () => "https://billing.example/private-ticket",
      billingTicket: async () => "private-upgrade-ticket",
    } as never),
    spyOn(external, "openExternalUrl").mockImplementation(async url => { urls.push(url); }),
  ];
  const sync = { transports: [{ ref: "webdav:main", label: "WebDAV" }],
    finishConnect: async () => { connects++; }, connectTransport: async () => { connects++; },
    disconnect: async () => {}, deleteAccount: async () => { deletes++; },
  } as unknown as ReturnType<typeof useSyncConnection>;
  let flows!: ReturnType<typeof useSyncAccountFlows>;
  function Harness() { flows = useSyncAccountFlows(sync, true); return null; }
  const root = createRoot(dom.window.document.getElementById("root")!);
  const tick = () => Bun.sleep(0);
  try {
    await initI18n("en");
    await act(async () => { root.render(<ToastProvider><Harness /></ToastProvider>); });
    let request!: Promise<HostSyncFlowReceipt>;
    await act(async () => { request = hostSyncFlows.request({ action: "connect", transportRef: "webdav:main" }); await tick(); });
    expect(flows.transportDialogRef).toBe("webdav:main"); expect(connects).toBe(0);
    await act(async () => { await flows.sync.connectTransport("webdav:main", "user-only-passphrase"); flows.setTransportDialogRef(null); });
    expect(await request).toEqual({ action: "connect", status: "completed" }); expect(connects).toBe(1);
    status = snapshot();
    await act(async () => { request = hostSyncFlows.request({ action: "delete-account" }); await tick(); });
    expect(flows.deleteAccountOpen).toBe(true); expect(deletes).toBe(0);
    await act(async () => { flows.setDeleteAccountOpen(false); });
    expect((await request).status).toBe("cancelled"); expect(deletes).toBe(0);
    await act(async () => { request = hostSyncFlows.request({ action: "delete-account" }); await tick(); });
    await act(async () => { await flows.deleteAccount(); });
    expect(await request).toEqual({ action: "delete-account", status: "completed" }); expect(deletes).toBe(1);
    for (const action of ["upgrade", "billing"] as const) {
      let receipt!: HostSyncFlowReceipt;
      await act(async () => { receipt = await hostSyncFlows.request({ action }); });
      expect(receipt).toEqual({ action, status: "external-opened" });
      expect(JSON.stringify(receipt)).not.toContain("private");
    }
    expect(urls).toHaveLength(2); expect(urls[0]).toContain("#upgrade=private-upgrade-ticket");
    const caller = new AbortController();
    await act(async () => { request = hostSyncFlows.request({ action: "disconnect" }, caller.signal); await tick(); });
    const rejected = request.catch(error => error);
    await act(async () => { caller.abort(Error("retired")); expect(await rejected).toMatchObject({ message: "retired" }); });
    expect(flows.disconnectOpen).toBe(false);
  } finally {
    await act(async () => { root.unmount(); });
    for (const mock of mocks) mock.mockRestore();
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
} else {
  test("isolated mounted sync account flow contract", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, SYNC_FLOW_HOOK_CASE: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("1 pass");
  }, 30_000);
}
