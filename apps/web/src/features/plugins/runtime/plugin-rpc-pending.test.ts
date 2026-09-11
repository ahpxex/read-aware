import { expect, test } from "bun:test";
import { PluginRpcPending } from "./plugin-rpc-pending";
import { pluginCallDrainsCancellation } from "./plugin-call-options";

test("conditional entity cancellation requests host arbitration, retains capacity and returns the real outcome", async () => {
  expect(pluginCallDrainsCancellation("domains.memory.commands.decideEntity")).toBe(true);
  expect(pluginCallDrainsCancellation("domains.memory.queries.entities")).toBe(false);
  for (const ok of [true, false]) {
    const rpc = new PluginRpcPending(120_000, 1), controller = new AbortController();
    let id = 0, cancelled = 0, settled = false;
    const pending = rpc.call(value => { id = value; }, { signal: controller.signal, drainCancellation: true, cancel: () => { cancelled++; } });
    const observed = pending.then(value => { settled = true; return value; }, error => { settled = true; return error; });
    controller.abort(); await Promise.resolve();
    expect(settled).toBe(false); expect(rpc.size).toBe(1); expect(cancelled).toBe(1);
    await expect(rpc.call(() => {})).rejects.toMatchObject({ code: "plugin/busy" });
    const result = ok ? { changed: true } : new Error("Native conflict");
    rpc.settle(id, ok, result);
    expect(await observed).toBe(result); expect(rpc.size).toBe(0);
  }
});

test("drained cancellation still rejects pre-aborted calls, deadlines and lost realms", async () => {
  const rpc = new PluginRpcPending(5), controller = new AbortController();
  let cancelled = 0;
  const pending = rpc.call(() => {}, { signal: controller.signal, drainCancellation: true, cancel: () => { cancelled++; } });
  controller.abort();
  await expect(rpc.call(() => { throw Error("must not dispatch"); }, { signal: controller.signal, drainCancellation: true })).rejects.toBeDefined();
  await expect(pending).rejects.toMatchObject({ code: "plugin/timeout", retryable: false });
  expect(cancelled).toBe(1); expect(rpc.size).toBe(0);
  const live = rpc.call(() => {}, { drainCancellation: true });
  rpc.close(new Error("Worker lost"));
  await expect(live).rejects.toThrow("Worker lost");
});

test("RPC settlement and late responses are bounded", async () => {
  const rpc = new PluginRpcPending(); let id = 0;
  const call = rpc.call(value => { id = value; });
  expect(rpc.has(id)).toBe(true);
  expect(rpc.settle(id, true, "done")).toBe(true);
  expect(rpc.has(id)).toBe(false);
  expect(rpc.settle(id, true, "late")).toBe(false);
  expect(await call).toBe("done"); expect(rpc.size).toBe(0);
});

test("pre-abort does not dispatch and live abort cancels exactly once", async () => {
  const rpc = new PluginRpcPending(); const controller = new AbortController();
  let sent = 0, cancelled = 0;
  const call = rpc.call(() => { sent++; }, { signal: controller.signal, cancel: () => { cancelled++; } }).catch(error => error);
  controller.abort(new Error("cancelled"));
  expect(await call).toMatchObject({ message: "cancelled" });
  await expect(rpc.call(() => { sent++; }, { signal: controller.signal })).rejects.toThrow("cancelled");
  expect(sent).toBe(1); expect(cancelled).toBe(1); expect(rpc.size).toBe(0);
});

test("deadline cancels a silent peer and rejects with a stable code", async () => {
  const rpc = new PluginRpcPending(5); let cancelled = 0;
  const error = await rpc.call(() => {}, { cancel: () => { cancelled++; } }).catch(error => error);
  expect(error).toMatchObject({ code: "plugin/timeout" }); expect(cancelled).toBe(1); expect(rpc.size).toBe(0);
});

test("clone errors, crash and terminal closure leave no pending promises", async () => {
  const rpc = new PluginRpcPending();
  await expect(rpc.call(() => { throw new Error("clone failed"); })).rejects.toThrow("clone failed");
  const pending = rpc.call(() => {}).catch(error => error);
  rpc.failAll(new Error("crashed")); expect(await pending).toMatchObject({ message: "crashed" });
  const afterCrash = rpc.call(id => rpc.settle(id, true, "alive")); expect(await afterCrash).toBe("alive");
  rpc.close(new Error("closed"));
  await expect(rpc.call(() => { throw new Error("must not dispatch"); })).rejects.toThrow("closed");
  expect(rpc.size).toBe(0);
});

test("in-flight quota rejects before dispatch and recovers after settlement", async () => {
  const rpc = new PluginRpcPending(120_000, 1); let id = 0;
  const first = rpc.call(value => { id = value; });
  const error = await rpc.call(() => { throw new Error("must not dispatch"); }).catch(error => error);
  expect(error).toMatchObject({ code: "plugin/busy" });
  rpc.settle(id, true, "done"); await first;
  expect(await rpc.call(id => rpc.settle(id, true, "next"))).toBe("next");
});
