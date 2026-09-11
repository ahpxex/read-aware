import { expect, test, spyOn } from "bun:test";
import { getDefaultStore } from "jotai";
import type { PluginFormValues, PluginSelectOption } from "@read-aware/plugin-types";
import { DynamicOptionsCache } from "./dynamic-options";
import { createSettingsDomain } from "./domain";
import { createSettingsPort } from "../../features/ai/agent/ports/settings-port";
import { installedPluginsAtom, registerSettingsOptionsContribution } from "../../features/plugins/state/plugin-store";
import { localKV } from "../../platform/local-store";
import { emitAppEvent } from "../../platform/app-events";
import { buildPluginContext } from "../../features/plugins/runtime/plugin-context";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const options = Array.from({ length: 105 }, (_, n) => ({ value: `voice-${n}`, label: `Voice ${n}` }));
function source(load: () => Promise<PluginSelectOption[]> = async () => options) {
  return { identity: {}, version: 1, pluginId: "voices", pluginName: "Voices", current: () => true, load };
}

test("dynamic options pin complete lists across searches and pages, with expiry and replacement", async () => {
  let now = 0, calls = 0;
  const cache = new DynamicOptionsCache(() => {}, () => now);
  const src = source(async () => { calls++; return [...options, options[0]!]; });
  const first = await cache.query({ path: "plugins.voices.voice", limit: 100 }, src);
  expect(first).toMatchObject({ total: 105, nextOffset: 100 });
  expect(() => cache.staticPage([], 1, { path: first.path, revision: first.revision, offset: 100 }))
    .toThrow("restart");
  const next = await cache.query({ path: first.path, revision: first.revision, offset: 100 }, src);
  expect(next.options).toHaveLength(5); expect(next.nextOffset).toBeNull();
  const match = await cache.query({ path: first.path, search: "voice-104" }, src);
  expect(match.options[0]?.value).toBe("voice-104"); expect(calls).toBe(1);
  match.options[0]!.label = "mutated";
  expect((await cache.query({ path: first.path, search: "voice-104" }, src)).options[0]?.label).toBe("Voice 104");
  await expect(cache.query({ path: "plugins.other.voice", revision: first.revision }, src)).rejects.toMatchObject({ code: "settings/options-stale" });
  now = 60_001;
  await expect(cache.query({ path: first.path, revision: first.revision }, src)).rejects.toMatchObject({ code: "settings/options-stale" });
  expect((await cache.query({ path: first.path }, src)).revision).not.toBe(first.revision);
  const replacement = { ...src, identity: {} };
  const newPage = await cache.query({ path: first.path }, replacement);
  await expect(cache.query({ path: first.path, revision: newPage.revision }, { ...replacement, version: 2 })).rejects.toMatchObject({ code: "settings/options-stale" });
});

test("dynamic providers are single-flight, bounded, cancellable to the caller and reject late stale results", async () => {
  const cache = new DynamicOptionsCache(() => {}, Date.now, 5);
  const finishes: Array<(value: PluginSelectOption[]) => void> = [];
  const loads = Array.from({ length: 4 }, () => source(() => new Promise(resolve => { finishes.push(resolve); })));
  const pending = loads.map((src, index) => cache.query({ path: `plugins.voices.field${index}` }, src));
  const outcomes = Promise.allSettled(pending);
  for (const outcome of await outcomes) expect(outcome).toMatchObject({ status: "rejected", reason: { code: "settings/options-unavailable" } });
  await expect(cache.query({ path: "plugins.voices.fifth" }, source())).rejects.toMatchObject({ code: "settings/options-unavailable" });
  for (const finish of finishes) finish(options); await tick();
  expect((await cache.query({ path: "plugins.voices.fifth" }, source())).total).toBe(105);

  let finish!: (value: PluginSelectOption[]) => void, calls = 0;
  const src = source(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const controller = new AbortController();
  const longer = new DynamicOptionsCache(() => {});
  const one = longer.query({ path: "plugins.voices.voice" }, src, controller.signal);
  const two = longer.query({ path: "plugins.voices.voice" }, src);
  await tick(); controller.abort(Error("cancelled"));
  await expect(one).rejects.toThrow("cancelled"); expect(calls).toBe(1);
  longer.invalidate("voices"); finish(options);
  await expect(two).rejects.toMatchObject({ code: "settings/options-stale" });
});

test("invalid, excessive or failed provider responses are errors rather than empty catalogs", async () => {
  const cache = new DynamicOptionsCache(() => {});
  for (const value of [null, [{}], [{ value: "v", label: "x".repeat(513) }], [{ value: "bad\n", label: "bad" }], Array(2001).fill(options[0])]) {
    await expect(cache.query({ path: "plugins.voices.voice" }, source(async () => value as PluginSelectOption[])))
      .rejects.toMatchObject({ code: "settings/options-invalid" });
  }
  await expect(cache.query({ path: "plugins.voices.voice" }, source(async () => { throw Object.assign(Error("private"), { code: "db/locked" }); })))
    .rejects.toMatchObject({ code: "db/locked" });
  expect((await cache.query({ path: "plugins.voices.voice" }, source(async () => []))).total).toBe(0);
});

test("Agent and granted plugin option queries use the owning provider, not caller values or secrets", async () => {
  const store = getDefaultStore(), previous = store.get(installedPluginsAtom);
  const manifest = { id: "dynamic-test", name: "Dynamic Test", version: "1", schemaVersion: 1, requires: {},
    permissions: ["service:network" as const], settings: [
      { kind: "select" as const, id: "voice", label: "Voice", options: [], dynamicOptions: true },
      { kind: "text" as const, id: "endpoint", label: "Endpoint", value: "https://default.example", agentHidden: true },
      { kind: "secret" as const, id: "key", label: "Key" },
      { kind: "select" as const, id: "hidden", label: "Hidden", options: [], dynamicOptions: true, agentHidden: true },
    ] };
  store.set(installedPluginsAtom, [{ manifest, enabled: true }]);
  const read = spyOn(localKV, "getItem").mockImplementation(key => key === "read-aware-plugin.dynamic-test.settings"
    ? JSON.stringify({ endpoint: "https://saved.example", key: "PRIVATE_KEY", extra: "PRIVATE_EXTRA" }) : null);
  let seen: PluginFormValues | undefined, calls = 0;
  const provider = registerSettingsOptionsContribution({ key: "dynamic-test:voice", pluginId: manifest.id, fieldId: "voice",
    resolve: async values => { seen = values; calls++; return options; } });
  const path = "plugins.dynamic-test.voice";
  const caller = buildPluginContext({ id: "dynamic-consumer", name: "Consumer", version: "1", schemaVersion: 1, requires: {},
    permissions: ["service:network"], settingsAccess: { discover: [path] } }, "0.5.4", []);
  try {
    await expect(caller.context.domains.settings.queries.options({ path })).rejects.toThrow("activating");
    expect(calls).toBe(0);
    caller.lifecycle.promote();
    const agent = createSettingsPort();
    expect((await agent.getSettings({ section: "plugins" })).settings.find(row => row.path === path)?.dynamicOptions).toBe(true);
    await expect(createSettingsDomain("plugin:no-network", { discover: [path] }).queries.options({ path })).rejects.toMatchObject({ code: "settings/options-forbidden" });
    await expect(createSettingsDomain("plugin:no-grant", undefined, true).queries.options({ path })).rejects.toMatchObject({ code: "settings/options-forbidden" });
    await expect(agent.getSettingOptions({ path: "plugins.dynamic-test.hidden" })).rejects.toMatchObject({ code: "settings/options-invalid" });
    const page = await caller.context.domains.settings.queries.options({ path, limit: 20 });
    expect(await agent.getSettingOptions({ path, limit: 20 })).toEqual(page);
    expect(calls).toBe(1); expect(seen).toEqual({ endpoint: "https://saved.example" });
    expect(JSON.stringify(page)).not.toContain("PRIVATE");
    expect(JSON.stringify(page)).not.toContain("saved.example");
    await expect(caller.context.domains.settings.queries.read(path)).rejects.toThrow();
    emitAppEvent("plugin-storage-changed", { pluginId: manifest.id });
    await expect(agent.getSettingOptions({ path, offset: 20, revision: page.revision })).rejects.toMatchObject({ code: "settings/options-stale" });
    provider.dispose();
    await expect(agent.getSettingOptions({ path })).rejects.toMatchObject({ code: "settings/options-unavailable" });
    caller.lifecycle.stop();
    await expect(caller.context.domains.settings.queries.options({ path })).rejects.toThrow();
  } finally { caller.lifecycle.stop(); provider.dispose(); read.mockRestore(); store.set(installedPluginsAtom, previous); }
});
