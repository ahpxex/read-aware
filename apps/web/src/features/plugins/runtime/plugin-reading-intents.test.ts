import { expect, test } from "bun:test";
import { createReadingIntentSources, wrapReadingIntent } from "./plugin-reading-intents";
import { PluginLifecycleController } from "./plugin-lifecycle";
import { buildPluginContext } from "./plugin-context";
import { getRegisteredAgentContextProviders } from "../state/plugin-store";
import type { PluginAgentContextProvider, RegisteredAgentContextProvider } from "../lib/plugin-types";
import { deferred } from "../../../../tests/helpers/profile-host";

function fixture() {
  const lifecycle = new PluginLifecycleController([]); lifecycle.promote();
  const calls: string[] = [], listeners = new Set<() => void>();
  const source: NonNullable<PluginAgentContextProvider["readingIntent"]> = { scopes: ["book"],
    prepare: async () => { calls.push("prepare"); }, read: async () => { calls.push("read"); return { text: "Goal", revision: "doc:1" }; } };
  const registered: RegisteredAgentContextProvider = { id: "goal", pluginId: "owner", pluginName: "Translated", key: "owner:goal", provide: () => [],
    readingIntent: wrapReadingIntent(source, lifecycle), readingIntentLifetime: lifecycle.signal };
  let providers = [registered];
  const service = createReadingIntentSources({ list: () => providers, observe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    requireBook: async id => { calls.push(`book:${id}`); } });
  return { service, lifecycle, source, registered, calls, listeners, change: (items: RegisteredAgentContextProvider[]) => { providers = items; for (const listener of listeners) listener(); } };
}
test("source leases recheck the book and exact declared scope, then release registry observation", async () => {
  const host = fixture(), lease = host.service.open({ kind: "book", id: "one" });
  await lease.prepare(); expect(await lease.read()).toEqual([{ pluginId: "owner", providerId: "goal", text: "Goal", revision: "doc:1" }]);
  expect(host.calls).toEqual(["book:one", "prepare", "book:one", "read"]);
  lease.dispose(); expect(host.listeners.size).toBe(0);
  const user = host.service.open({ kind: "user" }); await user.prepare(); expect(await user.read()).toEqual([]); user.dispose(); host.lifecycle.stop();
});
test("replacement and off/on permanently invalidate capture without invalidating unrelated registrations", async () => {
  for (const replace of [false, true]) {
    const host = fixture(), lease = host.service.open({ kind: "book", id: "one" }); await lease.prepare();
    const unrelated = { ...host.registered, key: "owner:other", id: "other", readingIntent: undefined };
    host.change([host.registered, unrelated]); expect(lease.signal.aborted).toBe(false);
    host.change(replace ? [{ ...host.registered }] : []); host.change([host.registered]);
    await expect(lease.read()).rejects.toMatchObject({ code: "memory/conflict" });
    lease.dispose(); host.lifecycle.stop();
  }
});
test("caller cancellation and realm retirement reject hanging source reads promptly", async () => {
  for (const retire of [false, true]) {
    const host = fixture(), gate = deferred(), entered = deferred(), caller = new AbortController();
    host.registered.readingIntent = wrapReadingIntent({ scopes: ["book"], prepare: async () => {}, read: async () => { entered.resolve(); await gate.promise; return { revision: "v1", text: "late" }; } }, host.lifecycle);
    const lease = host.service.open({ kind: "book", id: "one" }, caller.signal), pending = lease.read();
    await entered.promise; if (retire) host.lifecycle.stop(); else caller.abort();
    await expect(pending).rejects.toBeDefined(); gate.resolve(); lease.dispose(); await host.lifecycle.drainCleanups(); host.lifecycle.stop();
  }
});
test("provider errors reject the whole recipe and wrappers reject authority/schema injection", async () => {
  const host = fixture();
  host.registered.readingIntent = wrapReadingIntent({ scopes: ["book"], prepare: async () => {}, read: async () => { throw Error("source failed"); } }, host.lifecycle);
  const lease = host.service.open({ kind: "book", id: "one" });
  await expect(lease.read()).rejects.toThrow("source failed"); lease.dispose();
  for (const bad of [{ scopes: [], prepare: async () => {}, read: async () => ({}) }, { ...host.source, scopes: ["book", "book"] }, { ...host.source, path: "private" }]) {
    expect(() => wrapReadingIntent(bad as PluginAgentContextProvider["readingIntent"], host.lifecycle)).toThrow();
  }
  expect(() => host.registered.readingIntent!.read({ kind: "user" })).toThrow();
  host.lifecycle.stop();
});
test("production registration stays staged, brands the actual owner and overwrites a forged lifetime", async () => {
  const actor = buildPluginContext({ id: "intention-proof", name: "Intentions", version: "1", schemaVersion: 1,
    permissions: ["agent:context"], requires: { contributions: { agentContextProviders: "^1.1.0" } } }, "1", []);
  const provider = { id: "goal", provide: () => [], readingIntentLifetime: new AbortController().signal,
    readingIntent: { scopes: ["book" as const], prepare: async () => {}, read: async () => ({ revision: "v", text: "goal" }) } };
  actor.context.contributions.agentContextProviders!.register(provider);
  expect(getRegisteredAgentContextProviders().some(entry => entry.pluginId === "intention-proof")).toBe(false);
  actor.lifecycle.promote();
  const registered = getRegisteredAgentContextProviders().find(entry => entry.pluginId === "intention-proof")!;
  expect(registered.readingIntentLifetime).toBe(actor.lifecycle.signal);
  expect(await registered.readingIntent!.read({ kind: "book", id: "one" })).toEqual({ revision: "v", text: "goal" });
  actor.lifecycle.stop();
  expect(getRegisteredAgentContextProviders().some(entry => entry.pluginId === "intention-proof")).toBe(false);
});
