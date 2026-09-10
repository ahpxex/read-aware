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
