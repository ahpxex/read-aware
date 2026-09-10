import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildMaintenanceTools } from "./maintenance-tools";

test("Agent maintenance reads locally by default, propagates check failures and reveals without claiming completion", async () => {
  const { deps } = createInMemoryDeps(), calls: unknown[] = [], signal = new AbortController().signal;
  deps.maintenance.checkForUpdates = async s => { calls.push(s); throw Error("offline"); };
  deps.maintenance.openSettings = async (surface, s) => { calls.push([surface, s]); return { status: "opened", surface }; };
  const tools = buildMaintenanceTools(deps), call = (name: string, params: unknown) => tools.find(t => t.name === name)!.execute("test", params, signal);
  await call("get_software_update", {}); expect(calls).toHaveLength(0);
  await expect(call("get_software_update", { check: true })).rejects.toThrow("offline");
  const result = await call("open_maintenance_settings", { surface: "diagnostics" });
  expect(JSON.stringify(result)).toContain("opened"); expect(JSON.stringify(result)).not.toContain("completed");
  expect(calls).toEqual([signal, ["diagnostics", signal]]);
  for (const surface of ["plugins", "backup-import", "backup-export", "delete-data"]) {
    const result = await call("open_maintenance_settings", { surface });
    expect(JSON.stringify(result)).toContain("opened");
    expect(calls[calls.length - 1]).toEqual([surface, signal]);
  }
  await expect(call("open_maintenance_settings", { surface: "install" })).rejects.toMatchObject({ code: "ui/invalid-target" });
});

test("Agent verification uses the shared port, preserves cancellation and never converts failure into success", async () => {
  const { deps } = createInMemoryDeps(), signals: Array<AbortSignal | undefined> = [];
  const summary = { scope: "event-projections" as const, checkedAt: "2026-09-11T00:00:00Z", consistent: false,
    eventsReplayed: 20, driftedTables: 1, onlyLiveRows: 2, onlyReplayedRows: 0 };
  deps.diagnostics.verifyProjections = async signal => { signals.push(signal); return summary; };
  const tool = buildMaintenanceTools(deps).find(tool => tool.name === "verify_local_data")!;
  const signal = new AbortController().signal;
  expect(tool.executionMode).toBe("sequential");
  const result = await tool.execute("test", {}, signal);
  const content = result.content[0];
  if (content.type !== "text") throw new Error("Expected text");
  expect(JSON.parse(content.text)).toEqual(summary);
  expect(signals).toEqual([signal]);
  await expect(tool.execute("test", {}, AbortSignal.abort())).rejects.toBeDefined();
  expect(signals).toHaveLength(1);
  const failure = Object.assign(Error("pending"), { code: "sync/log-incomplete" });
  deps.diagnostics.verifyProjections = async () => { throw failure; };
  await expect(tool.execute("test", {}, signal)).rejects.toBe(failure);
});
