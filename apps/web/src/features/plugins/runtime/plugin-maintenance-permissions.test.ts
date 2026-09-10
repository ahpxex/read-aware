import { expect, test } from "bun:test";
import { buildPluginContext } from "./plugin-context";

test("maintenance is read-only without network and never exposes install/send/raw logs", async () => {
  const create = (network: boolean) => buildPluginContext({ id: `maintenance-${network}`, name: "Maintenance", version: "1", schemaVersion: 1,
    requires: {}, permissions: network ? ["service:network"] : [] }, "0.5.4", []);
  const a = create(false), b = create(true);
  try {
    a.lifecycle.promote(); b.lifecycle.promote();
    expect(Object.keys(a.context.services.maintenance).sort()).toEqual(["observe", "openSettings", "snapshot"]);
    expect(typeof b.context.services.maintenance.checkForUpdates).toBe("function");
    await expect(a.context.services.maintenance.openSettings("install" as never)).rejects.toMatchObject({ code: "ui/invalid-target" });
    a.lifecycle.stop(); b.lifecycle.stop();
    await expect(a.context.services.maintenance.snapshot()).rejects.toThrow();
    expect(() => b.context.services.maintenance.checkForUpdates!()).toThrow();
  } finally { a.lifecycle.stop(); b.lifecycle.stop(); }
});
