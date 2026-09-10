import { expect, spyOn, test } from "bun:test";
import { AppError } from "@read-aware/core";
import type { CatalogState } from "@read-aware/agent";
import { modelCatalog } from "../../features/ai/lib/model-catalog";
import { buildPluginContext } from "../../features/plugins/runtime/plugin-context";
import { createSettingsPort } from "../../features/ai/agent/ports/settings-port";

test("cached model metadata is paged and path-authorized without private selection or network", async () => {
  let state: CatalogState = { refreshing: false, checkedAt: 123, models: Array.from({ length: 3 }, (_, index) => ({
    id: `m${index}`, name: `Model ${index}`, provider: "openai", api: "openai-responses", baseUrl: "PRIVATE-ENDPOINT",
    reasoning: true, input: ["text", "image"], contextWindow: 1000, maxTokens: 100,
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, headers: { Authorization: "PRIVATE" },
  })) };
  const snapshot = spyOn(modelCatalog, "getSnapshot").mockImplementation(() => state);
  const refresh = spyOn(modelCatalog, "refresh").mockResolvedValue();
  const manifest = { id: "models", name: "Models", version: "1", schemaVersion: 1, requires: {} };
  const granted = buildPluginContext({ ...manifest, settingsAccess: { discover: ["ai.connection.primaryModel"] } }, "1", []);
  const denied = buildPluginContext({ ...manifest, permissions: ["service:network"] }, "1", []);
  granted.lifecycle.promote(); denied.lifecycle.promote();
  try {
    const settings = granted.context.domains.settings;
    expect(settings.commands.refreshModelCatalog).toBeUndefined();
    await expect(denied.context.domains.settings.queries.modelCatalog({ provider: "openai" })).rejects.toMatchObject({ code: "settings/options-forbidden" });
    await expect(denied.context.domains.settings.commands.refreshModelCatalog!("openai")).rejects.toMatchObject({ code: "settings/options-forbidden" });
    const first = await settings.queries.modelCatalog({ provider: "openai", limit: 2 });
    expect(first.nextOffset).toBe(2); expect(first.total).toBe(3);
    expect(JSON.stringify(first)).not.toMatch(/PRIVATE|baseUrl|headers|cost/);
    expect(first.models[0]).toMatchObject({ input: ["text", "image"], contextWindow: 1000, maxOutputTokens: 100 });
    const second = await settings.queries.modelCatalog({ provider: "openai", offset: 2, revision: first.revision });
    expect(second.models.map(model => model.id)).toEqual(["m2"]); expect(second.nextOffset).toBeNull();
    expect(await createSettingsPort().getModelCatalog({ provider: "openai", limit: 2 })).toEqual(first);
    state = { ...state, refreshing: true };
    await expect(settings.queries.modelCatalog({ provider: "openai", offset: 2, revision: first.revision })).rejects.toMatchObject({ code: "settings/options-stale" });
    await expect(settings.queries.modelCatalog({ provider: "custom" })).rejects.toMatchObject({ code: "settings/options-invalid" });
    expect(refresh).not.toHaveBeenCalled();
    granted.lifecycle.stop(); expect(() => settings.queries.modelCatalog({ provider: "openai" })).toThrow();
  } finally { granted.lifecycle.stop(); denied.lifecycle.stop(); snapshot.mockRestore(); refresh.mockRestore(); }
});

test("explicit refresh shares host work, returns final cache metadata, and rejects stale-cache failures", async () => {
  let state: CatalogState = { models: [], refreshing: false };
  const snapshot = spyOn(modelCatalog, "getSnapshot").mockImplementation(() => state);
  const gate = Promise.withResolvers<void>();
  let fail = false;
  const refresh = spyOn(modelCatalog, "refresh").mockImplementation(async (provider, force) => {
    expect(provider).toBe("openai"); expect(force).toBe(true); await gate.promise;
    state = { models: [], refreshing: false, checkedAt: 456, ...(fail ? { error: new AppError("ai/network", "PRIVATE") } : {}) };
  });
  const actor = buildPluginContext({ id: "refresh", name: "Refresh", version: "1", schemaVersion: 1, requires: {},
    settingsAccess: { discover: ["ai.connection.fastModel"] }, permissions: ["service:network"] }, "1", []);
  actor.lifecycle.promote();
  try {
    const run = actor.context.domains.settings.commands.refreshModelCatalog!;
    const abort = new AbortController(); const waiting = run("openai", { signal: abort.signal });
    abort.abort(); await expect(waiting).rejects.toThrow();
    gate.resolve(); await Bun.sleep(0);
    expect((await run("openai")).checkedAt).toBe(456);
    fail = true;
    await expect(run("openai")).rejects.toMatchObject({ code: "ai/network" });
    const cached = await actor.context.domains.settings.queries.modelCatalog({ provider: "openai" });
    expect(cached.errorCode).toBe("ai/network"); expect(JSON.stringify(cached)).not.toContain("PRIVATE");
    const before = refresh.mock.calls.length;
    expect(() => run("openai", { signal: abort.signal })).toThrow();
    expect(refresh.mock.calls.length).toBe(before);
  } finally { gate.resolve(); actor.lifecycle.stop(); snapshot.mockRestore(); refresh.mockRestore(); }
});
