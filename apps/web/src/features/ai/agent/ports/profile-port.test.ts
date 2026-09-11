import { expect, spyOn, test } from "bun:test";
import * as domain from "../../../../domain/user-profile";
import * as identity from "../../../../domain/identity-consolidation";
import { identityHost } from "../../../../../tests/helpers/identity-host";
import { createProfilePort } from "./profile-port";
import { buildPluginContext } from "../../../plugins/runtime/plugin-context";
import type { PluginPermission } from "@read-aware/plugin-types";
import { deferred, profileHost } from "../../../../../tests/helpers/profile-host";

test("prompt, onboarding, plugin pages and observations share the profile service with permission and retirement guards", async () => {
  const host = await profileHost("Reader profile");
  const spies = [
    spyOn(domain, "readUserProfile").mockImplementation(host.service.read),
    spyOn(domain, "readUserProfilePage").mockImplementation(host.service.page),
    spyOn(domain, "putUserProfile").mockImplementation(host.service.put),
    spyOn(domain, "changeUserProfile").mockImplementation(host.service.change),
  ];
  const runtimes: ReturnType<typeof buildPluginContext>[] = [];
  const actor = (permissions: PluginPermission[]) => {
    const runtime = buildPluginContext({ id: "profile-test", name: "Profile", version: "1.0.0", schemaVersion: 1,
      requires: { domains: { memory: "^2.0.0" } }, permissions }, "0.5.4", []);
    runtime.lifecycle.promote(); runtimes.push(runtime); return runtime;
  };
  try {
    const port = createProfilePort();
    expect(await port.getProfileSummary()).toBe("Reader profile");
    expect((await port.readProfile()).text).toBe("Reader profile");
    expect(actor([]).context.domains.memory).toBeUndefined();
    const runtime = actor(["memory:read"]), memory = runtime.context.domains.memory!;
    expect(memory.commands).toBeUndefined();
    expect((await memory.queries.profile()).text).toBe("Reader profile");
    let deliver!: (event: unknown) => void;
    const first = new Promise(resolve => { deliver = resolve; });
    const observation = memory.events.observe({ kind: "profile", query: { limit: 6 } }, deliver);
    expect(await first).toMatchObject({ status: "ready", result: { kind: "profile", profile: { text: "Reader", nextOffset: 6, persistence: "event-log" } } });
    observation.dispose(); runtime.lifecycle.stop();
    await expect(memory.queries.profile()).rejects.toBeDefined();
    expect(() => memory.events.observe({ kind: "profile" }, () => {})).toThrow();
    await port.putProfileSummary("Onboarding");
    expect(await port.getProfileSummary()).toBe("Onboarding");

    const writer = actor(["memory:write"]), commands = writer.context.domains.memory!.commands!;
    expect(Object.keys(commands)).not.toContain("restore");
    expect(Object.keys(commands)).not.toContain("initialize");
    const observed = await writer.context.domains.memory!.queries.profile();
    const entered = deferred(), gate = deferred();
    host.controls.beforeCommit = () => { entered.resolve(); return gate.promise; };
    const pending = commands.updateProfile({ summary: "Written", expectedRevision: observed.revision });
    await entered.promise; writer.lifecycle.stop();
    let drained = false;
    const draining = writer.lifecycle.drainCleanups().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    gate.resolve();
    expect(await pending).toMatchObject({ changed: true, persistence: "event-log" });
    await draining; expect(host.current().summary).toBe("Written");
    expect(host.calls.at(-1)).toMatchObject({ args: { event: { origin: "plugin:profile-test" } } });
    expect(() => commands.updateProfile({ summary: "Late", expectedRevision: observed.revision })).toThrow();
  } finally {
    for (const runtime of runtimes) runtime.lifecycle.stop();
    for (const spy of spies) spy.mockRestore();
  }
});

test("production profile context uses dedicated evidence reads without changing curated page or write semantics", async () => {
  const host = identityHost();
  const spy = spyOn(identity, "readProfileContext").mockImplementation(host.service.context);
  try {
    const port = createProfilePort();
    expect(await port.getProfileContext()).toEqual({ curated: "Curated", consolidated: null, derivedStatus: "absent" });
    host.controls.snapshot.derived = { version: 1, summary: "Valid inference", sources: [{ memoryId: "a", revision: host.controls.snapshot.sources[0]!.revision }], entityEvidence: [] };
    expect(await port.getProfileContext()).toMatchObject({ derivedStatus: "current", consolidated: { summary: "Valid inference" } });
    host.controls.snapshot.sources = [];
    expect(await port.getProfileContext()).toEqual({ curated: "Curated", consolidated: null, derivedStatus: "stale" });
    expect(host.calls.map(call => call.command)).toEqual(["profile_context", "profile_context", "profile_context"]);
    expect(host.minted).toHaveLength(0);
  } finally { spy.mockRestore(); }
});
