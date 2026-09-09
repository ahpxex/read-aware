import { afterEach, expect, spyOn, test } from "bun:test";
import type { PluginDisposable, PluginPermission } from "@read-aware/plugin-types";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import { readerPanels } from "./reader-panels";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function actor(permission?: PluginPermission) {
  const owned: PluginDisposable[] = [];
  const runtime = buildPluginContext({ id: "panel-permission", name: "Panels", version: "1.0.0", schemaVersion: 1,
    requires: { services: { ui: "^1.1.0" } }, permissions: permission ? [permission] : [] }, "0.5.4", owned);
  runtime.lifecycle.promote(); cleanups.push(() => runtime.lifecycle.stop());
  return runtime;
}
test("free UI services do not grant panel metadata or writes; reading grants determine the nested surface", () => {
  expect(actor().context.services.ui.reader).toBeUndefined();
  expect(actor("reading:read").context.services.ui.reader?.snapshot).toBeFunction();
  expect(actor("reading:read").context.services.ui.reader?.setPanel).toBeUndefined();
  expect(actor("reading:write").context.services.ui.reader?.setPanel).toBeFunction();
});
test("panel commands carry the plugin lifetime signal and stale captured methods reject after retirement", async () => {
  const runtime = actor("reading:write");
  const spy = spyOn(readerPanels, "setPanel").mockRejectedValue(new Error("expected probe")); cleanups.push(() => spy.mockRestore());
  const command = runtime.context.services.ui.reader!.setPanel!;
  await expect(command("toc", true, { sessionId: "session" })).rejects.toThrow("expected probe");
  expect(spy).toHaveBeenCalledWith("toc", true, runtime.lifecycle.signal, { sessionId: "session" });
  runtime.lifecycle.stop(); expect(runtime.lifecycle.signal.aborted).toBe(true);
  expect(() => command("toc", true)).toThrow();
  await expect(runtime.context.services.ui.reader!.snapshot()).rejects.toThrow();
});
