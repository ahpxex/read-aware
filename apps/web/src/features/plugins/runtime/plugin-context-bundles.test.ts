import { expect, spyOn, test } from "bun:test";
import { createContextBundle, domainGrantsFromPermissions, type ContextBundle, type DomainGrants, type PluginPermission, type ResourceRef } from "@read-aware/core";
import * as access from "../../../domain/context-bundle-access";
import * as resourceModule from "../../../services/resources";
import type { ResourceOwner } from "../../../services/resource-owner";
import { buildPluginContext } from "./plugin-context";
import { deferred } from "../../../../tests/helpers/entity-host";

const version = `cb1:${"a".repeat(64)}`;
function fakeAccess() {
  const actors: access.ContextBundleActor[] = [], calls: { op: string; signal: AbortSignal | undefined; owner?: unknown }[] = [];
  const controls = { gate: undefined as Promise<void> | undefined, entered: () => {} };
  let bundle: ContextBundle | undefined;
  const wait = async (op: string, signal?: AbortSignal, owner?: unknown) => {
    calls.push({ op, signal, owner }); controls.entered();
    if (controls.gate) await controls.gate;
  };
  const spy = spyOn(access, "contextBundleAccess").mockImplementation(actor => {
    actors.push(actor);
    return {
      capture: async (selector, signal) => { await wait(`capture:${selector.kind}`, signal); return { bundle: bundle!, changed: true, persistence: "event-log" }; },
      history: async (query, signal) => { await wait(`history:${query.kind}`, signal); return { selector: { kind: query.kind, scope: query.scope }, items: [], offset: 0, nextOffset: null, total: 0, revision: `cbhist1:${"a".repeat(64)}` }; },
      read: async (query, signal) => { await wait(`read:${query.kind}`, signal); return bundle ?? null; },
      export: async (_query, owner, signal) => { await wait("export", signal, owner);
        return { id: "ref", name: "x.json", mimeType: "application/json", size: 1, state: "ready", source: "context", expiresAt: 1 } as ResourceRef; },
    };
  });
  return { actors, calls, controls, spy, seed: async () => { bundle = await createContextBundle({ format: "readaware.context", schemaVersion: 1, recipeVersion: 1,
    kind: "user_profile_context", scope: { kind: "user" }, sourceRevision: "pctx1:test", items: [], omissions: [] }); return bundle; } };
}
const plugin = (permissions: PluginPermission[]) => {
  const runtime = buildPluginContext({ id: "bundle-test", name: "Bundles", version: "1.0.0", schemaVersion: 1,
    requires: { domains: permissions.some(p => p.startsWith("memory")) ? { memory: "^2.4.0" } : {} }, permissions }, "0.5.4", []);
  runtime.lifecycle.promote(); return runtime;
};

test("the memory domain exposes context bundles by grant: reads with memory:read, capture only with memory:write", async () => {
  const f = fakeAccess(); await f.seed();
  const runtimes: ReturnType<typeof plugin>[] = [];
  try {
    const none = plugin(["library:read"]); runtimes.push(none);
    expect(none.context.domains.memory).toBeUndefined();
    for (const permissions of [["memory:read", "annotations:read"], ["memory:write", "library:read", "conversations:read"]] as PluginPermission[][]) {
      const runtime = plugin(permissions); runtimes.push(runtime);
      const memory = runtime.context.domains.memory!;
      expect(typeof memory.queries.context.history).toBe("function");
      expect(Boolean(memory.commands?.context.capture)).toBe(permissions.includes("memory:write"));
      const actor = f.actors.find(candidate => candidate.origin === "plugin:bundle-test" && JSON.stringify(candidate.grants) === JSON.stringify(domainGrantsFromPermissions(permissions)));
      expect(actor).toBeDefined();
      expect(actor!.lifetime).toBe(runtime.lifecycle.signal);
      expect((await memory.queries.context.history({ kind: "user_profile_context", scope: { kind: "user" } })).total).toBe(0);
      expect((await memory.queries.context.read({ kind: "user_profile_context", scope: { kind: "user" }, version }))?.content.kind).toBe("user_profile_context");
      if (memory.commands) expect((await memory.commands.context.capture({ kind: "user_profile_context", scope: { kind: "user" } })).changed).toBe(true);
    }
    const grants: DomainGrants[] = f.actors.map(actor => actor.grants);
    expect(grants.every(grant => Object.isFrozen(grant) || Object.keys(grant).length <= 4)).toBe(true);
  } finally { for (const runtime of runtimes) { runtime.lifecycle.stop(); await runtime.lifecycle.drainCleanups(); } f.spy.mockRestore(); }
});

test("call options cancel the consumer, retirement drains the host read, and export uses the activation's own resource owner", async () => {
  const f = fakeAccess(); await f.seed();
  const owners: ResourceOwner[] = [];
  const original = resourceModule.createResourceOwner;
  const ownerSpy = spyOn(resourceModule, "createResourceOwner").mockImplementation((...args) => { const owner = original(...args); owners.push(owner); return owner; });
  const runtime = plugin(["memory:write"]);
  try {
    const memory = runtime.context.domains.memory!;
    const ref = await memory.queries.context.export({ kind: "user_profile_context", scope: { kind: "user" }, version });
    expect(ref.source).toBe("context");
    expect(owners).toHaveLength(1);
    expect(f.calls.at(-1)).toMatchObject({ op: "export", owner: owners[0] });
    const entered = deferred(), gate = deferred(), controller = new AbortController();
    f.controls.gate = gate.promise; f.controls.entered = () => entered.resolve();
    const pending = memory.queries.context.read({ kind: "user_profile_context", scope: { kind: "user" }, version }, { signal: controller.signal });
    await entered.promise; controller.abort(new Error("caller cancelled"));
    await expect(pending).rejects.toMatchObject({ message: "caller cancelled" });
    expect(f.calls.at(-1)!.signal!.aborted).toBe(true);
    gate.resolve(); await runtime.lifecycle.drainCleanups();
    const captureEntered = deferred(), captureGate = deferred();
    f.controls.gate = captureGate.promise; f.controls.entered = () => captureEntered.resolve();
    const capture = memory.commands!.context.capture({ kind: "user_profile_context", scope: { kind: "user" } }, { signal: new AbortController().signal });
    await captureEntered.promise;
    runtime.lifecycle.stop();
    expect(() => memory.queries.context.history({ kind: "user_profile_context", scope: { kind: "user" } })).toThrow();
    expect(() => memory.commands!.context.capture({ kind: "user_profile_context", scope: { kind: "user" } })).toThrow();
    expect(f.calls.at(-1)!.signal!.aborted).toBe(true);
    let drained = false; const draining = runtime.lifecycle.drainCleanups().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    captureGate.resolve();
    // A publication already dispatched still settles with its actual result for the caller.
    expect((await capture).changed).toBe(true);
    await draining;
    expect(() => memory.queries.context.export({ kind: "user_profile_context", scope: { kind: "user" }, version })).toThrow(expect.objectContaining({ code: "plugin/cancelled" }));
  } finally { runtime.lifecycle.stop(); await runtime.lifecycle.drainCleanups(); f.spy.mockRestore(); ownerSpy.mockRestore(); }
});

test("selector validation and grant failures surface as stable codes before any host read", async () => {
  const f = fakeAccess();
  f.spy.mockRestore();
  const runtime = plugin(["memory:read"]);
  try {
    const memory = runtime.context.domains.memory!;
    await expect(memory.queries.context.history({ kind: "book_memory_context", scope: { kind: "book", id: "b" } })).rejects.toMatchObject({ code: "memory/forbidden" });
    await expect(memory.queries.context.history({ kind: "user_profile_context", scope: { kind: "user" }, offset: 5 })).rejects.toMatchObject({ code: "memory/invalid-query" });
    await expect(memory.queries.context.read({ kind: "user_profile_context", scope: { kind: "user" }, version: "latest" } as never)).rejects.toMatchObject({ code: "memory/invalid-query" });
    await expect(memory.queries.context.export({ kind: "conversation_insights_context", scope: { kind: "conversation", id: "t" }, version })).rejects.toMatchObject({ code: "memory/forbidden" });
  } finally { runtime.lifecycle.stop(); await runtime.lifecycle.drainCleanups(); }
});
