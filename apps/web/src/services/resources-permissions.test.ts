import { expect, test } from "bun:test";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import type { PluginPermission } from "@read-aware/core";
import { decodePluginCallbacks } from "../features/plugins/runtime/plugin-callback-wire";
import { normalizePluginView } from "../features/plugins/lib/plugin-view";
import { pluginImageOwner } from "../features/plugins/lib/plugin-image-owner";

test("image declarations bind the production activation's resources without exposing a preview method", async () => {
  const plugin = buildPluginContext({ id: "image-view-test", name: "Image view", version: "1", schemaVersion: 1, requires: {}, permissions: [] }, "1", []);
  const view = normalizePluginView(decodePluginCallbacks({ data: { kind: "image", resourceId: "foreign", alt: "Image" }, callbacks: [] },
    () => null, undefined, plugin.lifecycle.signal));
  const owner = pluginImageOwner(view)!;
  try {
    expect(owner).toBeDefined();
    expect("imagePreview" in plugin.context.services.resources).toBe(false);
    await expect(owner.acquire("foreign", new AbortController().signal)).rejects.toThrow();
    plugin.lifecycle.promote();
    await expect(owner.acquire("foreign", new AbortController().signal)).rejects.toMatchObject({ code: "fs/not-found" });
    plugin.lifecycle.stop();
    await expect(owner.acquire("foreign", new AbortController().signal)).rejects.toMatchObject({ code: "plugin/unavailable" });
  } finally { plugin.lifecycle.stop(); await plugin.lifecycle.drainCleanups(); }
});

test("resource handles expose no raw paths and book acquisition requires library permission", async () => {
  for (const permissions of [[], ["library:read"], ["library:write"]] as PluginPermission[][]) {
    const plugin = buildPluginContext({ id: "resource-test", name: "Resource test", version: "1", schemaVersion: 1, requires: {}, permissions }, "1", []);
    const resources = plugin.context.services.resources;
    expect(Boolean(resources.openBook)).toBe(permissions.length > 0);
    expect(Boolean(resources.openCover)).toBe(permissions.length > 0);
    expect(Boolean(plugin.context.domains.library?.commands?.books.importResource)).toBe(permissions.includes("library:write"));
    expect(Boolean(plugin.context.domains.library?.queries.books.inspectResource)).toBe(permissions.length > 0);
    expect(() => resources.pick()).toThrow();
    plugin.lifecycle.promote();
    await expect(resources.stat("foreign-id")).rejects.toMatchObject({ code: "fs/not-found" });
    if (plugin.context.domains.library) {
      expect(await plugin.context.domains.library.queries.books.listFormats()).toHaveLength(9);
      await expect(plugin.context.domains.library.queries.books.inspectResource("foreign-id")).rejects.toMatchObject({ code: "fs/not-found" });
    }
    if (plugin.context.domains.library?.commands) {
      await expect(plugin.context.domains.library.commands.books.importResource("foreign-id")).rejects.toMatchObject({ code: "fs/not-found" });
    }
    await expect(resources.pick()).rejects.toMatchObject({ code: "ui/unavailable" });
    plugin.lifecycle.stop(); expect(() => resources.create({ name: "test.bin" })).toThrow();
    await plugin.lifecycle.drainCleanups();
  }
});

test("image clipboard is a separate grant and cannot consume a foreign resource", async () => {
  for (const permissions of [[], ["library:read"], ["service:clipboard"]] as PluginPermission[][]) {
    const plugin = buildPluginContext({ id: "image-test", name: "Image test", version: "1", schemaVersion: 1, requires: {}, permissions }, "1", []);
    const clipboard = plugin.context.services.clipboard;
    expect(Boolean(clipboard?.writeImage)).toBe(permissions.includes("service:clipboard"));
    plugin.lifecycle.promote();
    if (clipboard) await expect(clipboard.writeImage("foreign")).rejects.toMatchObject({ code: "fs/not-found" });
    plugin.lifecycle.stop();
    if (clipboard) expect(() => clipboard.writeImage("late")).toThrow();
    await plugin.lifecycle.drainCleanups();
  }
});
