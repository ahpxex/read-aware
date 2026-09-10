import { expect, test } from "bun:test";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import type { PluginPermission } from "@read-aware/core";

test("resource handles expose no raw paths and book acquisition requires library permission", async () => {
  for (const permissions of [[], ["library:read"], ["library:write"]] as PluginPermission[][]) {
    const plugin = buildPluginContext({ id: "resource-test", name: "Resource test", version: "1", schemaVersion: 1, requires: {}, permissions }, "1", []);
    const resources = plugin.context.services.resources;
    expect(Boolean(resources.openBook)).toBe(permissions.length > 0);
    expect(Boolean(plugin.context.domains.library?.commands?.books.importResource)).toBe(permissions.includes("library:write"));
    expect(() => resources.pick()).toThrow();
    plugin.lifecycle.promote();
    await expect(resources.stat("foreign-id")).rejects.toMatchObject({ code: "fs/not-found" });
    if (plugin.context.domains.library?.commands) {
      await expect(plugin.context.domains.library.commands.books.importResource("foreign-id")).rejects.toMatchObject({ code: "fs/not-found" });
    }
    await expect(resources.pick()).rejects.toMatchObject({ code: "ui/unavailable" });
    plugin.lifecycle.stop(); expect(() => resources.create({ name: "test.bin" })).toThrow();
    await plugin.lifecycle.drainCleanups();
  }
});
