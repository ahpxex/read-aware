import { expect, spyOn, test } from "bun:test";
import type { MemoryObservation, PluginPermission } from "@read-aware/core";
import * as domain from "../../../domain/identity-consolidation";
import { buildPluginContext } from "./plugin-context";
import { identityHost } from "../../../../tests/helpers/identity-host";
import { deferred } from "../../../../tests/helpers/entity-host";

test("profile inspection and observation require a memory grant and keep stale provenance out of the curated contract", async () => {
  const host = identityHost(), runtimes: ReturnType<typeof buildPluginContext>[] = [];
  const spy = spyOn(domain, "inspectProfileContext").mockImplementation(host.service.inspect);
  const actor = (permissions: PluginPermission[]) => {
    const runtime = buildPluginContext({ id: "profile-test", name: "Profile", version: "1.0.0", schemaVersion: 1,
      requires: { domains: permissions.length ? { memory: "^2.3.0" } : {} }, permissions }, "0.5.4", []);
    runtimes.push(runtime); runtime.lifecycle.promote(); return runtime;
  };
  try {
    expect(actor([]).context.domains.memory).toBeUndefined();
    for (const permission of ["memory:read", "memory:write"] as PluginPermission[]) {
      const runtime = actor([permission]), memory = runtime.context.domains.memory!;
      expect(await memory.queries.profileContext()).toMatchObject({ kind: "summary", derivedStatus: "absent" });
      expect(!!memory.commands).toBe(permission === "memory:write");
      const observed = deferred(), events: MemoryObservation[] = [];
      const subscription = memory.events.observe({ kind: "profileContext" }, event => { events.push(event); observed.resolve(); });
      await observed.promise; subscription.dispose();
      expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ status: "ready", result: { kind: "profileContext", page: { derivedStatus: "absent" } } });
      const entered = deferred(), gate = deferred(), controller = new AbortController();
      host.controls.beforeRead = () => { entered.resolve(); return gate.promise; };
      const pending = memory.queries.profileContext({}, { signal: controller.signal });
      await entered.promise; controller.abort(); await expect(pending).rejects.toBeDefined();
      gate.resolve(); await runtime.lifecycle.drainCleanups(); host.controls.beforeRead = async () => {};
      expect(await memory.queries.profileContext()).toMatchObject({ derivedStatus: "absent" });
      runtime.lifecycle.stop(); expect(() => memory.queries.profileContext()).toThrow();
    }
    expect(host.calls.every(call => call.command === "profile_context")).toBe(true);
    expect(host.minted).toHaveLength(0);
  } finally {
    for (const runtime of runtimes) { runtime.lifecycle.stop(); await runtime.lifecycle.drainCleanups(); }
    spy.mockRestore();
  }
});

test("retirement abandons inspection consumers, drains the native read and suppresses observer delivery", async () => {
  const host = identityHost(), entered = deferred(), gate = deferred();
  host.controls.beforeRead = () => { entered.resolve(); return gate.promise; };
  const spy = spyOn(domain, "inspectProfileContext").mockImplementation(host.service.inspect);
  const runtime = buildPluginContext({ id: "retired-profile", name: "Profile", version: "1.0.0", schemaVersion: 1, requires: {}, permissions: ["memory:read"] }, "0.5.4", []);
  runtime.lifecycle.promote(); const events: MemoryObservation[] = [];
  try {
    const memory = runtime.context.domains.memory!, query = { kind: "sources" as const, limit: 1 };
    const read = memory.queries.profileContext(query); query.limit = 100;
    memory.events.observe({ kind: "profileContext" }, event => { events.push(event); });
    await entered.promise; runtime.lifecycle.stop();
    await expect(read).rejects.toMatchObject({ code: "plugin/cancelled" });
    let drained = false; const draining = runtime.lifecycle.drainCleanups().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    gate.resolve(); await draining; expect(events).toHaveLength(0);
  } finally { gate.resolve(); runtime.lifecycle.stop(); await runtime.lifecycle.drainCleanups(); spy.mockRestore(); }
});
