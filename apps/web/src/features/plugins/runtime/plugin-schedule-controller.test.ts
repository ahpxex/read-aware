import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { PluginScheduleController, type ScheduleRecord } from "./plugin-schedule-controller";

const declaration = { id: "refresh", label: "Refresh", everyMinutes: 60 };
const command = (action: "pause" | "resume" | "run") => ({ pluginId: "test", id: "refresh", action });
function fixture() {
  const disk = new Map<string, Record<string, ScheduleRecord>>(), errors: unknown[] = [];
  let now = 1_000_000, fail = false;
  const storage = { read: (id: string) => structuredClone(disk.get(id) ?? {}),
    write: async (id: string, value: Record<string, ScheduleRecord>) => { if (fail) throw new AppError("db/locked", "locked"); disk.set(id, structuredClone(value)); } };
  return { controller: new PluginScheduleController(storage, error => errors.push(error), () => now), storage, disk, errors,
    fail: (value: boolean) => { fail = value; }, advance: () => { now += 3_600_000; } };
}
test("pause persists, manual run bypasses pause once, and attempt/success stamps survive a new controller", async () => {
  const f = fixture(); let calls = 0;
  const off = f.controller.register("test", declaration, () => { calls++; });
  await f.controller.control(command("pause")); f.controller.sweep(); await Bun.sleep(0); expect(calls).toBe(0);
  const result = await f.controller.control(command("run"));
  expect(result).toMatchObject({ status: "completed", schedule: { paused: true, running: false, lastOutcome: "succeeded", lastSuccessAt: 1_000_000 } });
  expect(calls).toBe(1); off.dispose();
  const fresh = new PluginScheduleController(f.storage, () => {});
  const next = fresh.register("test", declaration, () => {});
  expect(fresh.list().schedules[0]).toMatchObject({ paused: true, lastOutcome: "succeeded" }); next.dispose();
});
test("failures are not successes, periodic retries wait a cadence and persistence failure prevents dispatch", async () => {
  const f = fixture(); let calls = 0;
  const off = f.controller.register("test", declaration, () => { calls++; throw new AppError("sync/network", "failed"); });
  await expect(f.controller.control(command("run"))).rejects.toMatchObject({ code: "sync/network" });
  expect(f.controller.list().schedules[0]).toMatchObject({ lastOutcome: "failed", lastSuccessAt: null, lastErrorCode: "sync/network" });
  f.controller.sweep(); await Bun.sleep(0); expect(calls).toBe(1);
  f.advance(); f.controller.sweep(); await Bun.sleep(0); expect(calls).toBe(2);
  f.fail(true); await expect(f.controller.control(command("pause"))).rejects.toMatchObject({ code: "db/locked" });
  expect(f.controller.list().schedules[0].paused).toBe(false);
  await expect(f.controller.control(command("run"))).rejects.toMatchObject({ code: "db/locked" }); expect(calls).toBe(2);
  off.dispose();
});
test("in-flight callbacks block replacements from overlapping, and retired pending starts never execute", async () => {
  const f = fixture(); let finish!: () => void, replacementCalls = 0;
  const first = f.controller.register("test", declaration, () => new Promise<void>(resolve => { finish = resolve; }));
  const running = f.controller.control(command("run")); await Bun.sleep(0);
  const replacement = f.controller.register("test", declaration, () => { replacementCalls++; }); first.dispose();
  expect((await f.controller.control(command("run"))).status).toBe("already-running");
  finish(); await expect(running).rejects.toMatchObject({ code: "plugin/cancelled" });
  expect(f.controller.list().schedules[0].lastOutcome).toBe("interrupted");
  await f.controller.control(command("run")); expect(replacementCalls).toBe(1);
  const late = f.controller.control(command("run")); replacement.dispose();
  await expect(late).rejects.toMatchObject({ code: "plugin/cancelled" }); expect(replacementCalls).toBe(1);
  expect(f.controller.inspect()).toEqual([]);
});
test("same-plugin writes do not lose another schedule, and observations are scoped and disposable", async () => {
  const f = fixture(), a = f.controller.register("test", declaration, () => {}), b = f.controller.register("test", { ...declaration, id: "other" }, () => {});
  const foreign = f.controller.register("foreign", declaration, () => {}), seen: number[] = [];
  const stop = f.controller.observe({ pluginId: "test", limit: 1 }, page => { seen.push(page.total); expect(page.schedules.every(item => item.pluginId === "test")).toBe(true); });
  await Promise.all([f.controller.control(command("pause")), f.controller.control({ pluginId: "test", id: "other", action: "pause" })]);
  expect(f.disk.get("test")?.refresh.paused).toBe(true); expect(f.disk.get("test")?.other.paused).toBe(true);
  expect(f.controller.list({ pluginId: "test", limit: 1 }).nextOffset).toBe(1);
  stop(); const count = seen.length; a.dispose(); b.dispose(); foreign.dispose(); await Bun.sleep(0); expect(seen).toHaveLength(count);
  expect(() => f.controller.list({ limit: 101 })).toThrow();
});

test("retirement drains an accepted persistence write before a plugin snapshot can proceed", async () => {
  const f = fixture(); let release!: () => void;
  const write = f.storage.write;
  f.storage.write = async (id, records) => { await new Promise<void>(resolve => { release = resolve; }); await write(id, records); };
  const binding = f.controller.register("test", declaration, () => {});
  const pause = f.controller.control(command("pause")); await Bun.sleep(0); binding.dispose();
  let drained = false;
  const drain = f.controller.drainWrites("test").then(() => { drained = true; });
  await Bun.sleep(0); expect(drained).toBe(false);
  release(); await expect(pause).rejects.toMatchObject({ code: "plugin/cancelled" }); await drain;
  expect(f.disk.get("test")?.refresh.paused).toBe(true); expect(f.controller.inspect()).toEqual([]);
});
