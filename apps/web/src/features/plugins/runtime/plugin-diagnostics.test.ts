import { expect, spyOn, test } from "bun:test";
import { hostDiagnostics } from "../../../services/diagnostics";
import { buildPluginContext } from "./plugin-context";
import { PLUGIN_PERMISSIONS } from "@read-aware/core";

test("diagnostics needs its own grant and exposes only a cancellable count query", async () => {
  const create = (granted: boolean) => buildPluginContext({ id: `diagnostics-${granted}`, name: "Diagnostics", version: "1", schemaVersion: 1,
    requires: {}, permissions: granted ? ["service:diagnostics"] : ["library:read", "service:sync"] }, "1", []);
  const denied = create(false), granted = create(true);
  let received: AbortSignal | undefined;
  const operation = spyOn(hostDiagnostics, "verifyProjections").mockImplementation(signal => {
    received = signal;
    return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }));
  });
  try {
    denied.lifecycle.promote(); granted.lifecycle.promote();
    expect(denied.context.services.diagnostics).toBeUndefined();
    expect(Object.keys(granted.context.services.diagnostics!)).toEqual(["verifyProjections"]);
    expect(() => granted.context.services.diagnostics!.verifyProjections({ signal: AbortSignal.abort() })).toThrow();
    expect(operation).not.toHaveBeenCalled();
    const controller = new AbortController();
    const pending = granted.context.services.diagnostics!.verifyProjections({ signal: controller.signal });
    await Promise.resolve(); controller.abort(new Error("stopped"));
    await expect(pending).rejects.toThrow("stopped");
    expect(received!.aborted).toBe(true);
    expect(granted.lifecycle.signal.aborted).toBe(false);
    granted.lifecycle.stop();
    expect(() => granted.context.services.diagnostics!.verifyProjections()).toThrow();
  } finally {
    denied.lifecycle.stop(); granted.lifecycle.stop();
    await granted.lifecycle.drainCleanups(); operation.mockRestore();
  }
});

test("the diagnostic permission has explicit consent copy in every locale", async () => {
  expect(PLUGIN_PERMISSIONS).toContain("service:diagnostics");
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"]) {
    const catalog = await Bun.file(new URL(`../../../i18n/locales/${locale}/plugins.json`, import.meta.url)).json();
    expect(catalog.settings.permissionName.service_diagnostics.length).toBeGreaterThan(0);
    expect(catalog.settings.permission.service_diagnostics.length).toBeGreaterThan(0);
  }
});
