import { expect, spyOn, test } from "bun:test";
import { AppError } from "@read-aware/core";
import type { PluginPermission } from "@read-aware/plugin-types";
import * as domain from "../../../domain/entity-registry";
import { buildPluginContext } from "./plugin-context";
import { deferred, entityHost, entityRevision } from "../../../../tests/helpers/entity-host";

async function withActors(run: (host: ReturnType<typeof entityHost>, actor: (permissions: PluginPermission[], promote?: boolean) => ReturnType<typeof buildPluginContext>) => Promise<void>) {
  const host = entityHost(), runtimes: ReturnType<typeof buildPluginContext>[] = [];
  const spies = [spyOn(domain, "queryEntities").mockImplementation(host.service.query), spyOn(domain, "decideEntity").mockImplementation(host.service.decide)];
  const actor = (permissions: PluginPermission[], promote = true) => {
    const runtime = buildPluginContext({ id: "entity-test", name: "Entities", version: "1.0.0", schemaVersion: 1,
      requires: { domains: { memory: "^2.1.0" } }, permissions }, "0.5.4", []);
    if (promote) runtime.lifecycle.promote();
    runtimes.push(runtime); return runtime;
  };
  try { await run(host, actor); }
  finally {
    for (const runtime of runtimes) { runtime.lifecycle.stop(); await runtime.lifecycle.drainCleanups(); }
    for (const spy of spies) spy.mockRestore();
  }
}

const decision = () => ({ op: "merge" as const, keepId: "one", mergedId: "two", expectedRevision: entityRevision });

test("entity pages require a memory grant; decisions additionally require write and active lifecycle", async () => {
  await withActors(async (host, actor) => {
    expect(actor([]).context.domains.memory).toBeUndefined();
    const reader = actor(["memory:read"]).context.domains.memory!;
    expect(reader.commands).toBeUndefined();
    expect(await reader.queries.entities()).toEqual(host.controls.page);
    const writer = actor(["memory:write"], false), commands = writer.context.domains.memory!.commands!;
    expect(() => commands.decideEntity(decision())).toThrow(/activating/);
    writer.lifecycle.beginMigration();
    expect(() => commands.decideEntity(decision())).toThrow(/migrating/);
    writer.lifecycle.finishMigration(); writer.lifecycle.promote();
    await commands.decideEntity(decision());
    expect(host.calls.at(-1)).toMatchObject({ args: { event: { origin: "plugin:entity-test" } } });
    writer.lifecycle.stop();
    expect(() => commands.decideEntity(decision())).toThrow();
    expect(() => writer.context.domains.memory!.queries.entities()).toThrow();
  });
});

test("plugin entity reads copy before scheduling and cancel the consumer while retirement drains native reads", async () => {
  await withActors(async (host, actor) => {
    const reader = actor(["memory:read"]), entered = deferred(), gate = deferred();
    host.controls.beforeRead = () => { entered.resolve(); return gate.promise; };
    const query = { kind: "identities" as const, search: "Original" };
    const pending = reader.context.domains.memory!.queries.entities(query);
    query.search = "Changed";
    await entered.promise;
    reader.lifecycle.stop();
    await expect(pending).rejects.toMatchObject({ code: "plugin/cancelled" });
    let drained = false;
    const draining = reader.lifecycle.drainCleanups().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    gate.resolve(); await draining;
    expect(host.calls[0]).toMatchObject({ args: { query: { search: "Original" } } });
  });
});

test("caller cancellation does not retire the plugin, suppresses late pages and prevents pre-dispatch writes", async () => {
  await withActors(async (host, actor) => {
    const runtime = actor(["memory:write"]), memory = runtime.context.domains.memory!;
    const entered = deferred(), gate = deferred(), controller = new AbortController();
    host.controls.beforeRead = () => { entered.resolve(); return gate.promise; };
    const pending = memory.queries.entities(undefined, { signal: controller.signal });
    await entered.promise; controller.abort(); await expect(pending).rejects.toBeDefined();
    gate.resolve(); await runtime.lifecycle.drainCleanups();
    host.controls.beforeRead = async () => {};
    expect(await memory.queries.entities()).toEqual(host.controls.page);
    expect(() => memory.commands!.decideEntity(decision(), { signal: controller.signal })).toThrow();
    const mintEntered = deferred(), mintGate = deferred(), writeController = new AbortController();
    host.controls.beforeMint = () => { mintEntered.resolve(); return mintGate.promise; };
    const write = memory.commands!.decideEntity(decision(), { signal: writeController.signal });
    await mintEntered.promise; writeController.abort(); mintGate.resolve();
    await expect(write).rejects.toBeDefined();
    expect(host.calls.filter(call => call.command === "entity_commit")).toHaveLength(0);
  });
});

test("retiring a writer drains dispatched transactions and delivers the actual success or failure", async () => {
  await withActors(async (host, actor) => {
    for (const failure of [false, true]) {
      const writer = actor(["memory:write"]), entered = deferred(), gate = deferred();
      host.controls.beforeCommit = async () => {
        entered.resolve(); await gate.promise;
        if (failure) throw new AppError("memory/conflict", "Concurrent remote identity decision");
      };
      const pending = writer.context.domains.memory!.commands!.decideEntity(decision());
      await entered.promise; writer.lifecycle.stop();
      let drained = false;
      const draining = writer.lifecycle.drainCleanups().then(() => { drained = true; });
      await Promise.resolve(); expect(drained).toBe(false);
      gate.resolve();
      if (failure) await expect(pending).rejects.toMatchObject({ code: "memory/conflict" });
      else expect(await pending).toEqual(host.controls.receipt);
      await draining;
    }
    expect(host.broadcasts).toHaveLength(1);
    expect(host.calls.filter(call => call.command === "entity_commit")).toHaveLength(2);
  });
});
