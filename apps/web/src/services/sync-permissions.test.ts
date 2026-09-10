import { expect, spyOn, test } from "bun:test";
import type { PluginPermission } from "@read-aware/core";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import { hostSync } from "./sync";

test("sync control needs its own grant, not transport or network permission, and retires with its plugin", async () => {
  const create = (permissions: PluginPermission[]) => buildPluginContext({ id: "sync-permissions", name: "Sync", version: "1", schemaVersion: 1,
    requires: {}, permissions }, "0.5.4", []);
  for (const permissions of [[], ["sync:transport"], ["service:network"]] as PluginPermission[][]) {
    const plugin = create(permissions); expect(plugin.context.services.sync).toBeUndefined(); plugin.lifecycle.stop();
  }
  const plugin = create(["service:sync"]); plugin.lifecycle.promote();
  const sync = plugin.context.services.sync!;
  expect(sync.requestSync).toBeFunction(); expect(sync.openSettings).toBeFunction();
  expect(sync.requestFlow).toBeFunction(); expect(await sync.connectionOptions()).toEqual([]);
  expect((await sync.snapshot()).supported).toBe(false);
  expect(await sync.account()).toBeNull();
  await expect(sync.requestSync()).rejects.toMatchObject({ code: "ui/unavailable" });
  await expect(sync.requestFlow({ action: "connect" })).rejects.toMatchObject({ code: "ui/unavailable" });
  plugin.lifecycle.stop(); expect(() => sync.requestSync()).toThrow(); await expect(sync.snapshot()).rejects.toThrow();
});

test("public sync flow forwards its action and per-call cancellation without retiring its plugin", async () => {
  const plugin = buildPluginContext({ id: "sync-flow", name: "Sync", version: "1", schemaVersion: 1, requires: { services: { sync: "^1.1.0" } }, permissions: ["service:sync"] }, "1", []);
  plugin.lifecycle.promote();
  const operation = spyOn(hostSync, "requestFlow").mockImplementation((input, signal) => {
    expect(input).toEqual({ action: "connect", transportRef: "webdav:main" });
    return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }));
  });
  try {
    const caller = new AbortController();
    const request = plugin.context.services.sync!.requestFlow({ action: "connect", transportRef: "webdav:main" }, { signal: caller.signal });
    await Promise.resolve(); caller.abort(Error("stop flow"));
    await expect(request).rejects.toThrow("stop flow");
    expect(plugin.lifecycle.signal.aborted).toBe(false);
    plugin.lifecycle.stop(); expect(() => plugin.context.services.sync!.requestFlow({ action: "connect" })).toThrow();
  } finally { plugin.lifecycle.stop(); await plugin.lifecycle.drainCleanups(); operation.mockRestore(); }
});
