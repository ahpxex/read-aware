import { expect, test } from "bun:test";
import { pageSettingOptions, type SettingsOptionsQuery } from "@read-aware/core";
import { createSettingsDomain } from "./domain";
import { systemFontOptions } from "./font-options";
import { buildPluginContext } from "../../features/plugins/runtime/plugin-context";
import { createSettingsPort } from "../../features/ai/agent/ports/settings-port";

test("font options are searchable, paginated, copied and catalog-revision checked", () => {
  const all = systemFontOptions(["Alpha", "Beta", "Gamma"]);
  const first = pageSettingOptions(all, 4, { path: "reading.fontFamily", limit: 2 });
  expect(first).toMatchObject({ revision: 4, total: 3, offset: 0, nextOffset: 2 });
  expect(first.options[0]).toEqual({ value: "system:Alpha", label: "Alpha", source: "system" });
  first.options[0]!.label = "mutated";
  expect(all[0]!.label).toBe("Alpha");
  expect(pageSettingOptions(all, 4, { path: "reading.fontFamily", offset: 2, revision: 4 }).options[0]!.label).toBe("Gamma");
  expect(pageSettingOptions(all, 4, { path: "reading.fontFamily", search: " bETA " }).options).toEqual([all[1]!]);
  expect(pageSettingOptions(all, 4, { path: "reading.fontFamily", search: "missing" }).total).toBe(0);
  expect(() => pageSettingOptions(all, 5, { path: "reading.fontFamily", offset: 2, revision: 4 })).toThrow("restart");
  for (const patch of [{ offset: 1 }, { limit: 0 }, { limit: 101 }, { offset: -1 }, { search: "x".repeat(121) }, { target: { kind: "all-books" } }]) {
    expect(() => pageSettingOptions(all, 4, { path: "reading.fontFamily", ...patch } as SettingsOptionsQuery)).toThrow();
  }
});

test("option discovery honors path grants without revealing current values or other fields", async () => {
  const discovery = createSettingsDomain("plugin:options", { discover: ["appearance.theme", "reading.fontFamily"] });
  const options = await discovery.queries.options({ path: "appearance.theme", limit: 2 });
  expect(options.options).toHaveLength(2);
  expect(Object.keys(options).sort()).toEqual(["nextOffset", "offset", "options", "path", "revision", "total"]);
  await expect(discovery.queries.read("appearance.theme")).rejects.toThrow();
  await expect(discovery.queries.options({ path: "appearance.contentTypography.fontFamily" })).rejects.toMatchObject({ code: "settings/options-forbidden" });
  const fontOptions = await discovery.queries.options({ path: "reading.fontFamily", limit: 1 });
  expect(fontOptions.options[0]!.value).toMatch(/^curated:/);
  await expect(createSettingsDomain("plugin:empty").queries.options({ path: "reading.fontFamily" })).rejects.toMatchObject({ code: "settings/options-forbidden" });
  await expect(createSettingsDomain("agent").queries.options({ path: "ai.apiKey" })).rejects.toMatchObject({ code: "settings/options-invalid" });
});

test("plugin and Agent adapters consume the same option query and retirement rejects access", async () => {
  const runtime = buildPluginContext({ id: "font-options", name: "Font Options", version: "1", schemaVersion: 1, requires: {}, settingsAccess: { discover: ["appearance.theme"] } }, "0.5.4", []);
  try {
    const query = { path: "appearance.theme", search: "Light" };
    expect(await runtime.context.domains.settings.queries.options(query)).toEqual(await createSettingsPort().getSettingOptions(query));
    runtime.lifecycle.stop();
    await expect(runtime.context.domains.settings.queries.options(query)).rejects.toThrow();
  } finally { runtime.lifecycle.stop(); }
});
