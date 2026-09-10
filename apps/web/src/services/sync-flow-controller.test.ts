import { expect, test } from "bun:test";
import type { HostSyncFlowRequest } from "@read-aware/core";
import { SyncFlowController } from "./sync-flow-controller";

function fixture() {
  let epoch = 1, closed = 0;
  const opened: HostSyncFlowRequest[] = [];
  const controller = new SyncFlowController(async signal => { signal?.throwIfAborted(); }, () => epoch);
  const unbind = controller.bind({ open: input => { opened.push(input); }, close: () => { closed++; } });
  return { controller, opened, unbind, closed: () => closed, change: () => { epoch++; } };
}

test("each directed flow waits for the native action, with no fabricated purchase receipt", async () => {
  const f = fixture();
  for (const action of ["connect", "disconnect", "delete-account", "upgrade", "billing"] as const) {
    const request = f.controller.request({ action, ...(action === "connect" ? { transportRef: "plugin:backend" } : {}) });
    let done = false; void request.then(() => { done = true; });
    await Bun.sleep(0);
    expect(f.opened.at(-1)?.action).toBe(action); expect(done).toBe(false);
    await f.controller.run(action, async () => ({ secret: "never returned" }));
    expect(await request).toEqual({ action, status: action === "billing" || action === "upgrade" ? "external-opened" : "completed" });
  }
  f.unbind();
});

test("dismiss, unmount and caller abort do not execute unconfirmed operations", async () => {
  const f = fixture();
  const dismissed = f.controller.request({ action: "delete-account" }); await Bun.sleep(0);
  f.controller.dismiss("connect");
  await expect(f.controller.request({ action: "connect" })).rejects.toMatchObject({ code: "ui/unavailable" });
  f.controller.dismiss("delete-account");
  expect(await dismissed).toEqual({ action: "delete-account", status: "cancelled" });
  const abort = new AbortController();
  const cancelled = f.controller.request({ action: "disconnect" }, abort.signal); await Bun.sleep(0);
  abort.abort(Error("retired")); await expect(cancelled).rejects.toThrow("retired"); expect(f.closed()).toBe(1);
  const removed = f.controller.request({ action: "connect" }); await Bun.sleep(0); f.unbind();
  expect((await removed).status).toBe("cancelled");
  await expect(f.controller.request({ action: "connect" })).rejects.toMatchObject({ code: "ui/unavailable" });
});

test("confirmed work holds the slot through cancellation and only settles after its source", async () => {
  const f = fixture(), abort = new AbortController();
  const request = f.controller.request({ action: "delete-account" }, abort.signal); await Bun.sleep(0);
  let finish!: () => void;
  const work = f.controller.run("delete-account", () => new Promise<void>(resolve => { finish = resolve; }));
  abort.abort(Error("stop waiting")); f.unbind();
  await expect(f.controller.request({ action: "connect" })).rejects.toMatchObject({ code: "ui/unavailable" });
  await expect(f.controller.run("delete-account", async () => {})).rejects.toMatchObject({ code: "ui/unavailable" });
  expect(f.closed()).toBe(0);
  finish(); await work;
  await expect(request).rejects.toThrow("stop waiting"); expect(f.closed()).toBe(1);
});

test("connect can retry in the same host dialog; other failures reject rather than report success", async () => {
  const f = fixture();
  const request = f.controller.request({ action: "connect" }); await Bun.sleep(0);
  await expect(f.controller.run("connect", async () => { throw Error("wrong passphrase"); }, true)).rejects.toThrow();
  await expect(f.controller.request({ action: "disconnect" })).rejects.toMatchObject({ code: "ui/unavailable" });
  await f.controller.run("connect", async () => {}); expect((await request).status).toBe("completed");
  const failed = f.controller.request({ action: "disconnect" }); await Bun.sleep(0);
  const failure = failed.catch(error => error);
  await expect(f.controller.run("disconnect", async () => { throw Error("write failed"); })).rejects.toThrow("write failed");
  expect(await failure).toMatchObject({ message: "write failed" }); f.unbind();
});

test("invalid inputs and pre-cancellation do not open UI; account replacement invalidates confirmation", async () => {
  const f = fixture();
  for (const input of [null, { action: "unknown" }, { action: "billing", transportRef: "backend" }, { action: "connect", transportRef: "" }]) {
    await expect(f.controller.request(input as never)).rejects.toMatchObject({ code: "ui/invalid-target" });
  }
  await expect(f.controller.request({ action: "connect" }, AbortSignal.abort(Error("cancelled")))).rejects.toThrow("cancelled");
  expect(f.opened).toHaveLength(0);
  const stale = f.controller.request({ action: "delete-account" }); await Bun.sleep(0); f.change();
  let writes = 0;
  await expect(f.controller.run("delete-account", async () => { writes++; })).rejects.toMatchObject({ code: "ui/superseded" });
  await expect(stale).rejects.toMatchObject({ code: "ui/superseded" }); expect(writes).toBe(0); f.unbind();
});
