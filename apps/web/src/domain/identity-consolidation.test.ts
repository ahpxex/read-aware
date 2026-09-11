import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { deferred } from "../../tests/helpers/entity-host";
import { identityHost, identityPlan, identityRevision } from "../../tests/helpers/identity-host";

test("snapshot initializes first, preserves native evidence and rejects late reads or errors", async () => {
  const host = identityHost();
  expect(await host.service.snapshot()).toEqual(host.controls.snapshot);
  expect(host.initialized()).toBe(1);
  const gate = deferred(), entered = deferred(), controller = new AbortController();
  host.controls.beforeRead = () => { entered.resolve(); return gate.promise; };
  const pending = host.service.snapshot(controller.signal);
  await entered.promise; controller.abort(); gate.resolve();
  await expect(pending).rejects.toBeDefined();
  host.controls.beforeRead = async () => { throw new AppError("db/locked", "failed read"); };
  await expect(host.service.snapshot()).rejects.toMatchObject({ code: "db/locked" });
  expect(host.minted).toHaveLength(0);
});

test("commit freezes candidates and sources, assigns authority and provenance, broadcasts only actual emissions", async () => {
  const host = identityHost(), gate = deferred(), entered = deferred();
  host.controls.beforeInitialize = () => { entered.resolve(); return gate.promise; };
  const input = identityPlan(), pending = host.service.commit(input);
  input.summary = "Mutated"; input.sources[0]!.memoryId = "wrong"; input.decisions[0]!.memoryIds[0] = "wrong";
  if (input.decisions[0]!.input.op === "resolve") input.decisions[0]!.input.aliases![0] = "Wrong";
  await entered.promise; gate.resolve();
  expect(await pending).toEqual(host.controls.receipt);
  expect(host.calls).toHaveLength(1);
  expect(host.calls[0]).toMatchObject({ command: "identity_consolidation_commit", args: { expectedRevision: identityRevision, complete: true,
    entityEvents: [
      { id: "event-1", origin: "agent", aggregateType: "entity", aggregateId: "a", type: "entity.resolved", payload: { aliases: ["A"] } },
      { id: "event-2", origin: "agent", type: "entity.merged", payload: { keepId: "a", mergedId: "b" } },
    ],
    profileEvent: { id: "event-3", origin: "agent", type: "profile.updated", hlc: { counter: 3 }, payload: { traits: { consolidated: {
      version: 1, summary: "Derived", sources: identityPlan().sources,
      entityEvidence: [{ eventId: "event-1", memoryIds: ["a"] }, { eventId: "event-2", memoryIds: ["a"] }],
    } } } },
  } });
  expect(host.broadcasts.map(draft => draft.type)).toEqual(["entity.resolved", "profile.updated"]);
  expect(host.minted).toHaveLength(3);
});

test("invalid plans and pre-dispatch cancellation never enter the write transaction", async () => {
  for (const boundary of ["pre", "initialize", "entity-mint", "profile-mint"]) {
    const host = identityHost(), controller = new AbortController();
    if (boundary === "pre") controller.abort();
    if (boundary === "initialize") host.controls.beforeInitialize = async () => { controller.abort(); };
    let mints = 0;
    host.controls.beforeMint = async () => { if (++mints === (boundary === "entity-mint" ? 1 : boundary === "profile-mint" ? 2 : -1)) controller.abort(); };
    await expect(host.service.commit(identityPlan(), controller.signal)).rejects.toBeDefined();
    expect(host.calls).toHaveLength(0); expect(host.broadcasts).toHaveLength(0);
  }
  const host = identityHost();
  await expect(host.service.commit({ ...identityPlan(), origin: "user" } as never)).rejects.toMatchObject({ code: "memory/invalid-input" });
  expect(host.initialized()).toBe(0); expect(host.minted).toHaveLength(0);
});

test("dispatched writes drain cancellation to the native receipt or real failure without retries", async () => {
  for (const code of [undefined, "db/locked", "memory/conflict"] as const) {
    const host = identityHost(), controller = new AbortController(), gate = deferred(), entered = deferred();
    host.controls.beforeCommit = async () => { entered.resolve(); await gate.promise; if (code) throw new AppError(code, "native failure"); };
    const pending = host.service.commit(identityPlan(), controller.signal);
    await entered.promise; controller.abort(); gate.resolve();
    if (code) { await expect(pending).rejects.toMatchObject({ code }); expect(host.broadcasts).toHaveLength(0); }
    else expect(await pending).toEqual(host.controls.receipt);
    expect(host.calls).toHaveLength(1);
  }
});

test("partial/no-op receipt is not inflated, and invalid derived data is logged without losing curated profile", async () => {
  const host = identityHost(); host.controls.receipt = { revision: identityRevision, emittedEventIds: [], settled: false };
  const input = { ...identityPlan(), complete: false, decisions: [] };
  expect(await host.service.commit(input)).toEqual(host.controls.receipt);
  expect(host.minted).toHaveLength(1); expect(host.broadcasts).toHaveLength(0);
  host.controls.snapshot.derived = { version: 999, summary: "Unsafe" };
  expect(await host.service.context()).toEqual({ curated: "Curated", consolidated: null, derivedStatus: "invalid" });
  expect(host.warnings).toHaveLength(1);
  host.controls.snapshot.derived = { version: 1, summary: "Old", sources: [{ memoryId: "a", revision: `mem1:${"b".repeat(64)}` }], entityEvidence: [] };
  expect(await host.service.context()).toEqual({ curated: "Curated", consolidated: null, derivedStatus: "stale" });
  expect(host.warnings).toHaveLength(1);
});
