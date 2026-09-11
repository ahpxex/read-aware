import { expect, test } from "bun:test";
import { HOST_MAINTENANCE_SURFACES, type HostMaintenanceSnapshot, type WorkspaceSettingsSection } from "@read-aware/core";
import { HostMaintenanceService } from "./maintenance-controller";

function fixture() {
  const state: HostMaintenanceSnapshot = { phase: "idle", supported: true, channel: "stable", checkedChannel: null,
    currentVersion: "1.0", availableVersion: null, progress: null, errorStage: null };
  const listeners = new Set<() => void>(), errors: unknown[] = [];
  const adapter = { snapshot: () => ({ ...state }), check: async () => ({ ...state }), navigate: async (_section: WorkspaceSettingsSection, _signal?: AbortSignal) => {},
    subscribe: (handler: () => void) => { listeners.add(handler); return () => { listeners.delete(handler); }; } };
  const service = new HostMaintenanceService(adapter, error => errors.push(error));
  return { state, listeners, errors, adapter, service, notify: () => { for (const h of listeners) h(); } };
}

test("maintenance opens only mounted host controls after navigation; no export, send or install authority", async () => {
  const f = fixture(), calls: string[] = [];
  await expect(f.service.openSettings("diagnostics")).rejects.toMatchObject({ code: "ui/unavailable" });
  const old = f.service.bindSurface("diagnostics", () => { calls.push("old"); });
  const off = f.service.bindSurface("diagnostics", () => { calls.push("diagnostics"); }); old();
  f.adapter.navigate = async () => { calls.push("navigate"); };
  expect(await f.service.openSettings("diagnostics")).toEqual({ status: "opened", surface: "diagnostics" });
  expect(calls).toEqual(["navigate", "diagnostics"]);
  await expect(f.service.openSettings("send" as never)).rejects.toMatchObject({ code: "ui/invalid-target" });
  const abort = new AbortController(); f.adapter.navigate = async () => { abort.abort(); };
  await expect(f.service.openSettings("diagnostics", abort.signal)).rejects.toThrow();
  expect(calls).toHaveLength(2); off();
});

test("maintenance observation is initial, coalesced, serial and released with no payload mutation", async () => {
  const f = fixture(), release = Promise.withResolvers<void>(), seen: string[] = [];
  const off = f.service.observe(async state => { seen.push(state.phase); state.currentVersion = "tampered"; if (seen.length === 1) await release.promise; });
  f.state.phase = "checking"; f.notify(); f.state.phase = "available"; f.notify();
  expect(seen).toEqual(["idle"]); expect((await f.service.snapshot()).currentVersion).toBe("1.0");
  release.resolve(); await Bun.sleep(0); expect(seen).toEqual(["idle", "available"]);
  off(); off(); expect(f.listeners.size).toBe(0); f.notify(); expect(seen).toHaveLength(2);
  const failing = f.service.observe(() => { throw Error("callback"); });
  await Bun.sleep(0); expect(f.errors).toHaveLength(1); failing();
});

test("all management intents route to their real section and reveal only the registered entry", async () => {
  const f = fixture(), calls: unknown[] = [], signal = new AbortController().signal;
  f.adapter.navigate = async (section, received) => { calls.push([section, received]); };
  const expected = ["about", "about", "plugins", "dataSync", "dataSync", "dataSync", "ai", "dataSync"];
  for (const [index, surface] of HOST_MAINTENANCE_SURFACES.entries()) {
    const off = f.service.bindSurface(surface, () => { calls.push(surface); });
    expect(await f.service.openSettings(surface, signal)).toEqual({ status: "opened", surface });
    expect(calls.splice(0)).toEqual([[expected[index], signal], surface]);
    off();
    await expect(f.service.openSettings(surface, signal)).rejects.toMatchObject({ code: "ui/unavailable" });
    calls.length = 0;
  }
  await expect(f.service.openSettings("delete-data", AbortSignal.abort())).rejects.toBeDefined();
  expect(calls).toEqual([]);
});
