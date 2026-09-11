import { expect, test } from "bun:test";
import { ShutdownCoordinator } from "./shutdown";
import { AppError } from "@read-aware/core";

function fixture(now = () => 0) {
  const warnings: string[] = [];
  const coordinator = new ShutdownCoordinator(message => { warnings.push(message); }, now);
  return { coordinator, warnings };
}

test("settle owners run before persist owners, results are reported per owner and a failure degrades without blocking", async () => {
  const f = fixture(), order: string[] = [];
  f.coordinator.register("traces", "settle", async () => { order.push("traces"); });
  f.coordinator.register("plugins", "settle", async () => { order.push("plugins"); throw new AppError("plugin/unavailable", "PRIVATE"); });
  f.coordinator.register("kv", "persist", async () => { order.push("kv"); });
  const receipt = await f.coordinator.prepare();
  expect(order).toEqual(["traces", "plugins", "kv"]);
  expect(receipt.status).toBe("degraded");
  expect(receipt.owners).toEqual([
    { name: "traces", phase: "settle", status: "flushed" }, { name: "plugins", phase: "settle", status: "failed", code: "plugin/unavailable" },
    { name: "kv", phase: "persist", status: "flushed" }]);
  expect(f.warnings).toEqual(["Shutdown owner plugins failed"]);
  expect(f.coordinator.prepared).toBe(receipt);
});

test("a slow owner is timed out at the deadline, later owners still run, and the shared preparation is joined by concurrent callers", async () => {
  let clock = 0; const f = fixture(() => clock), gate = Promise.withResolvers<void>(), signals: AbortSignal[] = [];
  f.coordinator.register("slow", "settle", async signal => { signals.push(signal); await gate.promise; });
  f.coordinator.register("kv", "persist", async () => { clock += 5; });
  const first = f.coordinator.prepare({ deadlineMs: 20 }), second = f.coordinator.prepare({ deadlineMs: 1 });
  expect(second).toBe(first);
  await Bun.sleep(30);
  const receipt = await first;
  expect(signals[0]!.aborted).toBe(true);
  expect(receipt.owners.map(owner => [owner.name, owner.status])).toEqual([["slow", "timed-out"], ["kv", "flushed"]]);
  expect(receipt.owners[0]!.code).toBe("ui/unavailable");
  expect(receipt.status).toBe("degraded");
  gate.resolve();
  const again = await f.coordinator.prepare({ deadlineMs: 20 });
  expect(again).not.toBe(receipt); expect(again.status).toBe("ready");
});

test("registration is bounded and disposable; a caller abort ends preparation without a receipt", async () => {
  const f = fixture();
  expect(() => f.coordinator.register("", "settle", async () => {})).toThrow();
  expect(() => f.coordinator.register("x", "later" as never, async () => {})).toThrow();
  const dispose = f.coordinator.register("gone", "settle", async () => { throw new Error("must not run"); });
  dispose();
  const controller = new AbortController();
  const disposeWaiting = f.coordinator.register("waiting", "settle", async signal => { await new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); });
  const pending = f.coordinator.prepare({ signal: controller.signal });
  await Bun.sleep(0); controller.abort(new Error("caller cancelled"));
  await expect(pending).rejects.toMatchObject({ message: "caller cancelled" });
  expect(f.coordinator.prepared).toBeUndefined();
  await expect(f.coordinator.prepare({ deadlineMs: -1 })).rejects.toMatchObject({ code: "ui/invalid-target" });
  disposeWaiting();
  expect((await f.coordinator.prepare()).status).toBe("ready");
});
