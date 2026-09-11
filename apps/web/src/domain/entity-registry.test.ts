import { expect, test } from "bun:test";
import { AppError, type EntityDecision } from "@read-aware/core";
import { deferred, entityHost, entityRevision } from "../../tests/helpers/entity-host";

const candidate = (): EntityDecision => ({ op: "resolve", entityId: "one", kind: "person", canonicalName: "One", aliases: ["First"], expectedRevision: entityRevision });

test("all entity query modes normalize before IPC and preserve the native page", async () => {
  const host = entityHost();
  expect(await host.service.query()).toEqual(host.controls.page);
  expect(host.calls[0]).toEqual({ command: "entity_query", args: { query: { kind: "identities", offset: 0, limit: 25 } } });
  for (const kind of ["members", "aliases"] as const) {
    await host.service.query({ kind, entityId: "member", offset: 25, expectedRevision: entityRevision });
    expect(host.calls.at(-1)).toMatchObject({ args: { query: { kind, entityId: "member", offset: 25, expectedRevision: entityRevision } } });
  }
  expect(host.minted).toHaveLength(0);
});

test("query and write authority injection is rejected before any native work", async () => {
  const host = entityHost();
  await expect(host.service.query({ kind: "identities", limit: 101 })).rejects.toMatchObject({ code: "memory/invalid-query" });
  await expect(host.service.query({ kind: "members", entityId: "one", offset: 1 })).rejects.toMatchObject({ code: "memory/invalid-query" });
  await expect(host.service.decide({ ...candidate(), origin: "system" } as never, "agent")).rejects.toMatchObject({ code: "memory/invalid-input" });
  await expect(host.service.decide({ ...candidate(), expectedRevision: "old" }, "agent")).rejects.toMatchObject({ code: "memory/invalid-input" });
  expect(host.calls).toHaveLength(0); expect(host.minted).toHaveLength(0);
});

test("reads capture the query, propagate native errors and reject late cancelled pages", async () => {
  const host = entityHost(), entered = deferred(), gate = deferred(), controller = new AbortController();
  host.controls.beforeRead = () => { entered.resolve(); return gate.promise; };
  const query = { kind: "identities" as const, search: "Original" };
  const pending = host.service.query(query, controller.signal);
  query.search = "Changed";
  await entered.promise; controller.abort(); gate.resolve();
  await expect(pending).rejects.toBeDefined();
  expect(host.calls[0]).toMatchObject({ args: { query: { search: "Original" } } });
  host.controls.beforeRead = async () => { throw new AppError("db/locked", "not an empty registry"); };
  await expect(host.service.query()).rejects.toMatchObject({ code: "db/locked" });
});

test("resolve captures exact aliases and origin before minting, dispatch then drains to actual receipt", async () => {
  const host = entityHost(), entered = deferred(), gate = deferred(), controller = new AbortController();
  host.controls.beforeCommit = () => { entered.resolve(); return gate.promise; };
  const input = candidate();
  const pending = host.service.decide(input, "plugin:entities", controller.signal);
  if (input.op === "resolve") { input.aliases![0] = "Altered"; input.canonicalName = "Changed"; }
  input.expectedRevision = `entities1:${"c".repeat(64)}`;
  await entered.promise; expect(host.broadcasts).toHaveLength(0);
  expect(host.calls[0]).toMatchObject({ command: "entity_commit", args: { expectedRevision: entityRevision,
    event: { origin: "plugin:entities", aggregateType: "entity", aggregateId: "one", type: "entity.resolved",
      payload: { entityId: "one", kind: "person", canonicalName: "One", aliases: ["First"] } } } });
  controller.abort(); gate.resolve();
  expect(await pending).toEqual(host.controls.receipt);
  expect(host.broadcasts).toEqual(host.minted);
});

test("merge uses original requested ids, never invents a host-side redirect, and no-op does not broadcast", async () => {
  const host = entityHost(); host.controls.receipt.changed = false;
  await host.service.decide({ op: "merge", keepId: "one", mergedId: "two", expectedRevision: entityRevision }, "user");
  expect(host.calls[0]).toMatchObject({ args: { event: { type: "entity.merged", origin: "user", aggregateId: "one", payload: { keepId: "one", mergedId: "two" } } } });
  expect(host.broadcasts).toHaveLength(0);
});

test("cancellation before dispatch prevents native writes, including while mint is pending", async () => {
  const host = entityHost();
  await expect(host.service.decide(candidate(), "agent", AbortSignal.abort())).rejects.toBeDefined();
  await expect(host.service.query(undefined, AbortSignal.abort())).rejects.toBeDefined();
  expect(host.minted).toHaveLength(0);
  const entered = deferred(), gate = deferred(), controller = new AbortController();
  host.controls.beforeMint = () => { entered.resolve(); return gate.promise; };
  const pending = host.service.decide(candidate(), "agent", controller.signal);
  await entered.promise; controller.abort(); gate.resolve();
  await expect(pending).rejects.toBeDefined();
  expect(host.calls).toHaveLength(0); expect(host.broadcasts).toHaveLength(0);
});

test("conflicts and transaction failures are visible with no broadcast or blind retry", async () => {
  for (const code of ["memory/conflict", "db/locked", "memory/not-found"] as const) {
    const host = entityHost();
    host.controls.beforeCommit = async () => { throw new AppError(code, "native transaction rejected"); };
    await expect(host.service.decide(candidate(), "agent")).rejects.toMatchObject({ code });
    expect(host.calls).toHaveLength(1); expect(host.minted).toHaveLength(1); expect(host.broadcasts).toHaveLength(0);
  }
});
