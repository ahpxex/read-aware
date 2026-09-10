import { expect, test } from "bun:test";
import type { PluginPermission } from "@read-aware/core";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";

test("sync control needs its own grant, not transport or network permission, and retires with its plugin", async () => {
  const create = (permissions: PluginPermission[]) => buildPluginContext({ id: "sync-permissions", name: "Sync", version: "1", schemaVersion: 1,
    requires: {}, permissions }, "0.5.4", []);
  for (const permissions of [[], ["sync:transport"], ["service:network"]] as PluginPermission[][]) {
    const plugin = create(permissions); expect(plugin.context.services.sync).toBeUndefined(); plugin.lifecycle.stop();
  }
  const plugin = create(["service:sync"]); plugin.lifecycle.promote();
  const sync = plugin.context.services.sync!;
  expect(sync.requestSync).toBeFunction(); expect(sync.openSettings).toBeFunction();
  expect((await sync.snapshot()).supported).toBe(false);
  expect(await sync.account()).toBeNull();
  await expect(sync.requestSync()).rejects.toMatchObject({ code: "ui/unavailable" });
  plugin.lifecycle.stop(); expect(() => sync.requestSync()).toThrow(); await expect(sync.snapshot()).rejects.toThrow();
});
