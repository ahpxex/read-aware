import { expect, spyOn, test } from "bun:test";
import { seedMemory } from "@read-aware/agent/testing";
import { createMemoryPort } from "../features/ai/agent/ports/memory-port";
import * as store from "../features/ai/agent/ports/memory-store";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import type { PluginPermission } from "@read-aware/plugin-types";

test("public page uses the production memory port with domain authorization and retirement", async () => {
  const rows = Array.from({ length: 105 }, (_, index) => seedMemory({ id: `m${String(index).padStart(3, "0")}`, scope: "user", content: `Memory ${index}` }));
  const read = spyOn(store, "listAllMemoryRows").mockImplementation(async () => structuredClone(rows));
  const runtimes: ReturnType<typeof buildPluginContext>[] = [];
  const actor = (permissions: PluginPermission[]) => {
    const runtime = buildPluginContext({ id: "memory-page-test", name: "Memory Page", version: "1.0.0", schemaVersion: 1,
      requires: { domains: { memory: "^1.8.0" } }, permissions }, "0.5.4", []);
    runtime.lifecycle.promote(); runtimes.push(runtime); return runtime;
  };
  try {
    expect(actor([]).context.domains.memory).toBeUndefined();
    const runtime = actor(["memory:read"]), memory = runtime.context.domains.memory!;
    expect(memory.commands).toBeUndefined();
    const first = await memory.queries.page({ scopes: ["user"], limit: 100 });
    const last = await memory.queries.page({ scopes: ["user"], offset: first.nextOffset!, expectedRevision: first.revision });
    expect(first.items).toHaveLength(100); expect(last.items).toHaveLength(5); expect(last.nextOffset).toBeNull();
    expect((await createMemoryPort().searchMemories({ scopes: ["user"], limit: 100 })).map(row => row.id)).toEqual(first.items.map(row => row.id));
    expect(memory.events.observe).toBeFunction();
    runtime.lifecycle.stop();
    await expect(memory.queries.page({ scopes: ["user"] })).rejects.toMatchObject({ code: "plugin/cancelled" });
    const failed = actor(["memory:read"]).context.domains.memory!;
    read.mockImplementation(async () => { throw Object.assign(Error("private cause"), { code: "db/locked" }); });
    await expect(failed.queries.page({ scopes: ["user"] })).rejects.toMatchObject({ code: "db/locked" });
  } finally {
    for (const runtime of runtimes) { runtime.lifecycle.stop(); await runtime.lifecycle.drainCleanups(); }
    read.mockRestore();
  }
});
