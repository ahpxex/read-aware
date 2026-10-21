import { expect, test } from "bun:test";
import { CONTRIBUTION_CATALOG } from "@read-aware/core";
import * as registry from "../features/plugins/state/plugin-store";
import { registerSyncTransport } from "../platform/sync/transport-registry";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import { pluginUriRegistry } from "../features/plugins/lib/plugin-uri";
import { pluginContributions, pluginContributionPage } from "./plugin-contributions";
import { hostIO } from "./host-io";
import { actorCause, causalActor, eventCause, stampEventCause } from "../platform/domain-actor";
import type { PluginActionRegistration, PluginEventRegistration, PluginReactionEvent } from "@read-aware/plugin-types";

test("every current contribution point is discoverable without invoking or exposing a provider", async () => {
  let calls = 0;
  const forbidden = () => {
    calls++;
    throw Error("Provider callback must not run");
  };
  const registrars = [
    registry.registerSelectionActionContribution,
    registry.registerHeaderActionContribution,
    registry.registerContextActionContribution,
    registry.registerCommandContribution,
    registry.registerSettingsOptionsContribution,
    registry.registerSettingsPageContribution,
    registry.registerVoiceProviderContribution,
    registry.registerContentProviderContribution,
    registry.registerReaderModeContribution,
    registry.registerToolContribution,
    registry.registerAgentContextProviderContribution,
    registry.registerAgentRetrievalProviderContribution,
    registry.registerMemoryCandidateProviderContribution,
    registry.registerThemeContribution,
    registry.registerFontContribution,
  ];
  const registrations = registrars.map((register) =>
    register({
      key: "discovery:main",
      pluginId: "discovery",
      id: "main",
      providerId: "main",
      fieldId: "main",
      label: "PRIVATE LABEL",
      pluginName: "Name",
      secret: "PRIVATE SECRET",
      path: "/private/path",
      run: forbidden,
      view: forbidden,
      execute: forbidden,
      resolve: forbidden,
      load: forbidden,
      synthesize: forbidden,
    } as never),
  );
  const transport = registerSyncTransport("discovery", { id: "main", label: "PRIVATE LABEL", open: forbidden });
  const actor = buildPluginContext(
    {
      id: "discovery-consumer",
      name: "Consumer",
      version: "1",
      schemaVersion: 1,
      requires: { services: { plugins: "^1.1.0" } },
      permissions: [],
    },
    "1",
    [],
  );
  const uriHandler = pluginUriRegistry.register({
    id: "main",
    open: forbidden,
    pluginId: "discovery",
    pluginName: "Name",
    key: "discovery:main",
  });
  actor.lifecycle.promote();
  try {
    const page = await actor.context.services.plugins.contributions({ pluginId: "discovery" });
    expect(Object.keys(CONTRIBUTION_CATALOG).sort()).toEqual(page.contributions.map((item) => item.point).sort());
    expect(page.total).toBe(17);
    expect(calls).toBe(0);
    expect(JSON.stringify(page)).not.toMatch(/PRIVATE|secret|\/private\/|execute|synthesize|label/);
    expect(page.contributions.find((item) => item.point === "syncTransports")?.key).toBe("plugin:discovery:main");
    expect(await hostIO.listPluginContributions({ pluginId: "discovery" })).toEqual(page);
    const first = await pluginContributions.list({ pluginId: "discovery", limit: 1 });
    expect(first.nextOffset).toBe(1);
    expect((await pluginContributions.list({ pluginId: "discovery", point: "settingsOptions" })).contributions).toEqual(
      [{ pluginId: "discovery", point: "settingsOptions", key: "discovery:main" }],
    );
    page.contributions[0]!.key = "changed";
    expect(JSON.stringify(await pluginContributions.list({ pluginId: "discovery" }))).not.toContain("changed");
    actor.lifecycle.stop();
    await expect(actor.context.services.plugins.contributions()).rejects.toThrow();
  } finally {
    actor.lifecycle.stop();
    uriHandler.dispose();
    for (const item of registrations) item.dispose();
    await transport();
  }
});

test("observation is initial, serial, coalesced and retired with its consumer", async () => {
  const actor = buildPluginContext(
    { id: "observe-contributions", name: "Observe", version: "1", schemaVersion: 1, requires: {}, permissions: [] },
    "1",
    [],
  );
  actor.lifecycle.promote();
  const gate = Promise.withResolvers<void>(),
    seen: number[] = [];
  const observer = actor.context.services.plugins.observeContributions({ pluginId: "observed" }, async (page) => {
    seen.push(page.total);
    if (seen.length === 1) await gate.promise;
  });
  const one = registry.registerContentProviderContribution({
    pluginId: "observed",
    key: "observed:a",
    providerId: "a",
    load: async () => {
      throw Error("not called");
    },
  });
  const two = registerSyncTransport("observed", {
    id: "b",
    label: "Backend",
    open: async () => {
      throw Error("not called");
    },
  });
  try {
    expect(seen).toEqual([0]);
    gate.resolve();
    await Bun.sleep(0);
    expect(seen).toEqual([0, 2]);
    one.dispose();
    await Bun.sleep(0);
    expect(seen).toEqual([0, 2, 1]);
    actor.lifecycle.stop();
    await two();
    await Bun.sleep(0);
    expect(seen).toEqual([0, 2, 1]);
  } finally {
    gate.resolve();
    observer.dispose();
    actor.lifecycle.stop();
    one.dispose();
    await two();
  }
});

test("filters and entry budgets cannot produce broken identities or endless empty pages", () => {
  for (const query of [
    null,
    { point: "__proto__" },
    { point: "unknown" },
    { pluginId: "" },
    { offset: -1 },
    { limit: 101 },
    { invoke: true },
  ]) {
    expect(() => pluginContributionPage([], query as never)).toThrow();
  }
  const entries = Array.from({ length: 30 }, (_, i) => ({
    point: "commands" as const,
    pluginId: "bounded",
    key: `${i.toString().padStart(2, "0")}-${"x".repeat(1000)}`,
  }));
  const first = pluginContributionPage(entries, { limit: 100 });
  expect(first.contributions.length).toBeGreaterThan(0);
  expect(first.contributions.length).toBeLessThan(30);
  expect(first.nextOffset).toBe(first.contributions.length);
  const next = pluginContributionPage(entries, { offset: first.nextOffset! });
  expect(next.contributions[0]!.key).toBe(entries[first.nextOffset!]!.key);
  expect(() => pluginContributionPage([{ point: "commands", pluginId: "bad", key: "x".repeat(17000) }])).toThrow(
    "budget",
  );
});

test("public contribution observations bind existing handles, stop A/B loops and preserve later independent actions", async () => {
  for (const mode of ["all", "book"] as const) {
    const make = (name: string) => {
      const runtime = buildPluginContext(
        { id: name, name, version: "1", schemaVersion: 1, requires: {}, permissions: [] },
        "1",
        [],
        mode === "book" ? { mode, bookId: "book" } : { mode },
      );
      runtime.lifecycle.promote();
      return runtime;
    };
    const a = make(`causal-a-${mode}`),
      b = make(`causal-b-${mode}`);
    const register = (runtime: typeof a) =>
      runtime.context.contributions.commands.register({ id: "command", title: "Command", run: () => {} });
    const ha = register(a),
      hb = register(b),
      subscriptions: { dispose(): void }[] = [];
    let armed = false,
      writes = 0,
      cycles = 0,
      revision = 0;
    let expired: PluginEventRegistration<PluginActionRegistration> | undefined;
    try {
      for (const [runtime, handle] of [
        [a, ha],
        [b, hb],
      ] as const) {
        subscriptions.push(
          runtime.context.services.plugins.observeContributions({}, async (page, delivery) => {
            if (!armed) return;
            expect(JSON.stringify(page)).not.toMatch(/reaction|cause/);
            if (delivery?.reaction?.status === "cycle") {
              cycles++;
              return;
            }
            const bound = runtime.context.withEvent(delivery, handle);
            expired = bound;
            expect(() => runtime.context.withEvent(delivery, runtime === a ? hb : ha)).toThrow(
              expect.objectContaining({ code: "plugin/invalid-cause" }),
            );
            if (++writes > 20) return; // Bound a regression without hiding a failed loop assertion.
            await Promise.resolve();
            expect(await bound.updateState({ revision: ++revision, visible: true, enabled: true })).toEqual({
              status: "applied",
            });
          }),
        );
      }
      await Bun.sleep(0);
      armed = true;
      await ha.updateState({ revision: ++revision, visible: true, enabled: false });
      await Bun.sleep(0);
      expect(writes).toBeGreaterThanOrEqual(2);
      expect(writes).toBeLessThan(20);
      expect(cycles).toBeGreaterThan(0);
      expect(() => expired!.updateState({ revision: ++revision, visible: true, enabled: false })).toThrow(
        expect.objectContaining({ code: "plugin/invalid-cause" }),
      );
      await expect(expired!.dispose()).rejects.toMatchObject({ code: "plugin/invalid-cause" });
      const before = writes;
      await ha.updateState({ revision: ++revision, visible: true, enabled: false });
      await Bun.sleep(0);
      expect(writes).toBeGreaterThan(before);
      expect(writes).toBeLessThan(20);
      armed = false;
      let source: object | undefined;
      const off = pluginContributions.observe({}, (_page, event) => {
        source = event;
      });
      const event = stampEventCause({}, causalActor("user")),
        rule = {};
      try {
        await a.reactions.deliver(rule, event, async (reaction) => {
          const delivery: PluginReactionEvent = { reaction },
            origin = a.reactions.actor(reaction);
          const created = a.context
            .withEvent(delivery)
            .contributions.commands.register({ id: "new", title: "New", run: () => {} });
          await Bun.sleep(0);
          expect(eventCause(source!)).toBe(actorCause(origin));
          await a.context.withEvent(delivery, created).dispose();
          await Bun.sleep(0);
          expect(eventCause(source!)).toBe(actorCause(origin));
          expect(() => a.context.withEvent(delivery, subscriptions[0]!)).toThrow(
            expect.objectContaining({ code: "plugin/invalid-cause" }),
          );
        });
      } finally {
        off();
      }
    } finally {
      armed = false;
      for (const subscription of subscriptions) subscription.dispose();
      ha.dispose();
      hb.dispose();
      a.lifecycle.stop();
      b.lifecycle.stop();
      await Promise.all([a.lifecycle.drainCleanups(), b.lifecycle.drainCleanups()]);
    }
  }
});
