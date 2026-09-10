import { expect, test } from "bun:test";
import { CONTRIBUTION_CATALOG } from "@read-aware/core";
import * as registry from "../features/plugins/state/plugin-store";
import { registerSyncTransport } from "../platform/sync/transport-registry";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import { pluginContributions, pluginContributionPage } from "./plugin-contributions";
import { hostIO } from "./host-io";

test("every current contribution point is discoverable without invoking or exposing a provider", async () => {
  let calls = 0;
  const forbidden = () => { calls++; throw Error("Provider callback must not run"); };
  const registrars = [
    registry.registerSelectionActionContribution, registry.registerHeaderActionContribution, registry.registerContextActionContribution,
    registry.registerCommandContribution, registry.registerSettingsOptionsContribution, registry.registerVoiceProviderContribution,
    registry.registerContentProviderContribution, registry.registerReaderModeContribution, registry.registerToolContribution,
    registry.registerAgentContextProviderContribution, registry.registerAgentRetrievalProviderContribution,
    registry.registerMemoryCandidateProviderContribution, registry.registerThemeContribution, registry.registerFontContribution,
  ];
  const registrations = registrars.map(register => register({ key: "discovery:main", pluginId: "discovery", id: "main",
    providerId: "main", fieldId: "main", label: "PRIVATE LABEL", pluginName: "Name", secret: "PRIVATE SECRET", path: "/private/path",
    run: forbidden, view: forbidden, execute: forbidden, resolve: forbidden, load: forbidden, synthesize: forbidden,
  } as never));
  const transport = registerSyncTransport("discovery", { id: "main", label: "PRIVATE LABEL", open: forbidden });
  const actor = buildPluginContext({ id: "discovery-consumer", name: "Consumer", version: "1", schemaVersion: 1,
    requires: { services: { plugins: "^1.1.0" } }, permissions: [] }, "1", []);
  actor.lifecycle.promote();
  try {
    const page = await actor.context.services.plugins.contributions({ pluginId: "discovery" });
    expect(Object.keys(CONTRIBUTION_CATALOG).sort()).toEqual(page.contributions.map(item => item.point).sort());
    expect(page.total).toBe(15); expect(calls).toBe(0);
    expect(JSON.stringify(page)).not.toMatch(/PRIVATE|secret|\/private\/|execute|synthesize|label/);
    expect(page.contributions.find(item => item.point === "syncTransports")?.key).toBe("plugin:discovery:main");
    expect(await hostIO.listPluginContributions({ pluginId: "discovery" })).toEqual(page);
    const first = await pluginContributions.list({ pluginId: "discovery", limit: 1 });
    expect(first.nextOffset).toBe(1);
    expect((await pluginContributions.list({ pluginId: "discovery", point: "settingsOptions" })).contributions).toEqual([
      { pluginId: "discovery", point: "settingsOptions", key: "discovery:main" },
    ]);
    page.contributions[0]!.key = "changed";
    expect(JSON.stringify(await pluginContributions.list({ pluginId: "discovery" }))).not.toContain("changed");
    actor.lifecycle.stop(); await expect(actor.context.services.plugins.contributions()).rejects.toThrow();
  } finally { actor.lifecycle.stop(); for (const item of registrations) item.dispose(); await transport(); }
});

test("observation is initial, serial, coalesced and retired with its consumer", async () => {
  const actor = buildPluginContext({ id: "observe-contributions", name: "Observe", version: "1", schemaVersion: 1, requires: {}, permissions: [] }, "1", []);
  actor.lifecycle.promote();
  const gate = Promise.withResolvers<void>(), seen: number[] = [];
  const observer = actor.context.services.plugins.observeContributions({ pluginId: "observed" }, async page => {
    seen.push(page.total); if (seen.length === 1) await gate.promise;
  });
  const one = registry.registerContentProviderContribution({ pluginId: "observed", key: "observed:a", providerId: "a", load: async () => { throw Error("not called"); } });
  const two = registerSyncTransport("observed", { id: "b", label: "Backend", open: async () => { throw Error("not called"); } });
  try {
    expect(seen).toEqual([0]); gate.resolve(); await Bun.sleep(0); expect(seen).toEqual([0, 2]);
    one.dispose(); await Bun.sleep(0); expect(seen).toEqual([0, 2, 1]);
    actor.lifecycle.stop(); await two(); await Bun.sleep(0); expect(seen).toEqual([0, 2, 1]);
  } finally { gate.resolve(); observer.dispose(); actor.lifecycle.stop(); one.dispose(); await two(); }
});

test("filters and entry budgets cannot produce broken identities or endless empty pages", () => {
  for (const query of [null, { point: "__proto__" }, { point: "unknown" }, { pluginId: "" }, { offset: -1 }, { limit: 101 }, { invoke: true }]) {
    expect(() => pluginContributionPage([], query as never)).toThrow();
  }
  const entries = Array.from({ length: 30 }, (_, i) => ({ point: "commands" as const, pluginId: "bounded", key: `${i.toString().padStart(2, "0")}-${"x".repeat(1000)}` }));
  const first = pluginContributionPage(entries, { limit: 100 });
  expect(first.contributions.length).toBeGreaterThan(0); expect(first.contributions.length).toBeLessThan(30);
  expect(first.nextOffset).toBe(first.contributions.length);
  const next = pluginContributionPage(entries, { offset: first.nextOffset! });
  expect(next.contributions[0]!.key).toBe(entries[first.nextOffset!]!.key);
  expect(() => pluginContributionPage([{ point: "commands", pluginId: "bad", key: "x".repeat(17000) }])).toThrow("budget");
});
