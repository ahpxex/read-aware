import { afterEach, expect, spyOn, test } from "bun:test";
import type { PluginDisposable, PluginPermission } from "@read-aware/plugin-types";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import { workspace } from "./workspace";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function actor(permissions: PluginPermission[], promote = true) {
  const owned: PluginDisposable[] = [];
  const runtime = buildPluginContext({ id: "workspace-permission", name: "Workspace", version: "1.0.0", schemaVersion: 1,
    requires: { services: { ui: "^1.3.0" } }, permissions }, "0.5.4", owned);
  if (promote) runtime.lifecycle.promote(); cleanups.push(() => runtime.lifecycle.stop()); return runtime;
}
test("workspace disclosure and navigation are gated separately, and leaving a reader adds its own grant", async () => {
  expect(actor([]).context.services.ui.workspace).toBeUndefined();
  expect(actor(["reading:write"]).context.services.ui.workspace).toBeUndefined();
  expect(actor(["library:read"]).context.services.ui.workspace?.snapshot).toBeFunction();
  expect(actor(["library:read"]).context.services.ui.workspace?.navigate).toBeUndefined();
  const spy = spyOn(workspace, "navigate").mockRejectedValue(new Error("probe")); cleanups.push(() => spy.mockRestore());
  for (const reading of [false, true]) {
    const runtime = actor(reading ? ["library:write", "reading:write"] : ["library:write"]);
    const command = runtime.context.services.ui.workspace!.navigate!;
    await expect(command({ surface: "stats" }, 12)).rejects.toThrow("probe");
    expect(spy).toHaveBeenLastCalledWith({ surface: "stats" }, 12, runtime.lifecycle.signal, reading);
    runtime.lifecycle.stop(); expect(() => command({ surface: "stats" })).toThrow();
    await expect(runtime.context.services.ui.workspace!.snapshot()).rejects.toThrow();
  }
  const activating = actor(["library:write"], false);
  expect(() => activating.context.services.ui.workspace!.navigate!({ surface: "stats" })).toThrow();
});

test("host commands cannot use registration permission as navigation or settings authority", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  cleanups.push(() => { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage"); });
  expect(actor([]).context.services.ui.commands).toBeUndefined();
  expect(actor(["reading:write"]).context.services.ui.commands).toBeUndefined();
  const read = actor(["library:read"]);
  expect(read.context.services.ui.commands?.list).toBeFunction();
  expect(read.context.services.ui.commands?.execute).toBeUndefined();
  const write = actor(["library:write"]), api = write.context.services.ui.commands!;
  expect(api.execute).toBeFunction();
  const snapshot = await api.list();
  expect(snapshot.commands.filter(c => c.settingsPath).every(c => c.unavailableReason === "permission" && c.checked === undefined)).toBe(true);
  await expect(api.execute!({ id: "layout-list" })).rejects.toMatchObject({ code: "ui/unavailable" });
  write.lifecycle.stop(); expect(() => api.execute!({ id: "go-stats" })).toThrow();
  expect(() => api.list()).toThrow();
  const activating = actor(["library:write"], false);
  expect(() => activating.context.services.ui.commands!.execute!({ id: "go-stats" })).toThrow();
});
