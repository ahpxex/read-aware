import { afterEach, expect, spyOn, test } from "bun:test";
import { getDefaultStore } from "jotai";
import { hostIO } from "./host-io";
import { pluginDirectory, pluginDirectoryPage } from "./plugin-directory";
import { installedPluginsAtom } from "../features/plugins/state/plugin-store";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import type { PluginPermission } from "@read-aware/plugin-types";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function actor(permissions: PluginPermission[]) {
  const runtime = buildPluginContext({ id: "host-io-test", name: "Host IO", version: "1.0.0", schemaVersion: 1, requires: {}, permissions }, "0.5.4", []);
  runtime.lifecycle.promote(); cleanups.push(() => runtime.lifecycle.stop()); return runtime;
}
test("plugin clipboard and external links require grants and stop accepting work on retirement", async () => {
  const empty = actor([]).context.services;
  expect(empty.clipboard).toBeUndefined(); expect(empty.ui.openExternal).toBeUndefined();
  expect(empty.plugins.list).toBeFunction();
  const calls: unknown[] = [];
  const clipboard = spyOn(hostIO, "writeClipboard").mockImplementation(async (...args) => { calls.push(args); });
  const external = spyOn(hostIO, "openExternal").mockImplementation(async (...args) => { calls.push(args); });
  cleanups.push(() => clipboard.mockRestore(), () => external.mockRestore());
  const runtime = actor(["service:clipboard", "service:network"]);
  await runtime.context.services.clipboard!.writeText("requested");
  await runtime.context.services.ui.openExternal!("https://example.com/");
  expect(calls).toEqual([["requested", runtime.lifecycle.signal], ["https://example.com/", runtime.lifecycle.signal]]);
  runtime.lifecycle.stop();
  expect(() => runtime.context.services.clipboard!.writeText("late")).toThrow();
  expect(() => runtime.context.services.ui.openExternal!("https://example.com/")).toThrow();
  await expect(runtime.context.services.plugins.list()).rejects.toThrow();
});
test("plugin directory projects only public metadata and observers release", async () => {
  const store = getDefaultStore(), original = store.get(installedPluginsAtom);
  cleanups.push(() => store.set(installedPluginsAtom, original));
  const installed = [{ manifest: { id: "desk", name: "A desk", version: "1.0.0", schemaVersion: 1,
    description: "PRIVATE", settings: { password: "SECRET" } }, enabled: true, error: "RAW SECRET" }];
  const page = pluginDirectoryPage(installed as never, { limit: 1 });
  expect(page.plugins).toEqual([{ id: "desk", name: "A desk", version: "1.0.0", builtin: false, enabled: true, activationFailed: true }]);
  expect(JSON.stringify(page)).not.toMatch(/PRIVATE|SECRET|password/);
  const pages: unknown[] = [];
  store.set(installedPluginsAtom, []);
  const off = pluginDirectory.observe({}, value => pages.push(value));
  store.set(installedPluginsAtom, installed as never);
  expect(pages).toHaveLength(2); off(); store.set(installedPluginsAtom, []); expect(pages).toHaveLength(2);
  expect((await pluginDirectory.list()).total).toBe(0);
});
