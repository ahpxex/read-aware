import { expect, spyOn, test } from "bun:test";
import { userProfilePage } from "@read-aware/core";
import * as store from "../platform/local-store";
import { KVWriteQueue } from "../platform/kv-write-queue";
import { changeUserProfile } from "./user-profile";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import type { PluginPermission } from "@read-aware/plugin-types";

test("conditional profile writes share the durable KV queue, reject competing edits and preserve failed values", async () => {
  let value: string | null = "Original", durable = value;
  let persist: () => Promise<void> = async () => {};
  const actors: unknown[] = [];
  const queue = new KVWriteQueue({ read: () => value, mirror: (_key, next) => { value = next; },
    persist: async () => {}, committed: () => {}, failed: () => {}, settled: commit => { actors.push(commit.actor); } });
  const read = spyOn(store.localKV, "getItem").mockImplementation(key => key === "read-aware-agent-profile" ? value : null);
  const barrier = spyOn(store, "afterLocalKVWrites").mockImplementation(operation => queue.afterPending(operation));
  const write = spyOn(store, "setLocalKVBatch").mockImplementation((entries, actor, source, owner) =>
    queue.batch(entries, async () => { await persist(); durable = [...entries.values()][0]!; }, actor, source, owner));
  const runtimes: ReturnType<typeof buildPluginContext>[] = [];
  const actor = (permissions: PluginPermission[]) => {
    const runtime = buildPluginContext({ id: "profile-write", name: "Profile", version: "1.0.0", schemaVersion: 1,
      requires: { domains: { memory: "^1.7.0" } }, permissions }, "0.5.4", []);
    runtime.lifecycle.promote(); runtimes.push(runtime); return runtime;
  };
  try {
    expect(actor([]).context.domains.memory).toBeUndefined();
    expect(actor(["memory:read"]).context.domains.memory?.commands).toBeUndefined();
    const runtime = actor(["memory:write"]), memory = runtime.context.domains.memory!;
    const input = { summary: "Candidate", expectedRevision: (await memory.queries.profile()).revision };
    let start!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { start = resolve; });
    persist = () => { start(); return new Promise(resolve => { release = resolve; }); };
    let finished = false;
    const pending = memory.commands!.updateProfile(input).then(receipt => { finished = true; return receipt; });
    input.summary = "Mutated caller input";
    await started;
    expect(finished).toBe(false); expect(durable).toBe("Original");
    runtime.lifecycle.stop();
    let drained = false;
    const draining = runtime.lifecycle.drainCleanups().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    release();
    expect(await pending).toMatchObject({ changed: true, persistence: "device-local" });
    await draining; expect(durable).toBe("Candidate"); expect(actors).toEqual(["plugin:profile-write"]);
    expect(() => memory.commands!.updateProfile(input)).toThrow();

    persist = async () => {};
    const expectedRevision = (await userProfilePage(value ?? undefined)).revision;
    const results = await Promise.allSettled([
      changeUserProfile({ expectedRevision, summary: "First" }, "agent"),
      changeUserProfile({ expectedRevision, summary: "Second" }, "agent"),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "memory/conflict" } });
    expect(value).toBe(durable);
    const committed = value, revision = (await userProfilePage(value ?? undefined)).revision;
    persist = async () => { throw new Error("disk failure"); };
    await expect(changeUserProfile({ expectedRevision: revision, summary: "Failed" }, "agent")).rejects.toThrow("disk failure");
    expect(value).toBe(committed); expect(durable).toBe(committed);
    await expect(changeUserProfile({ expectedRevision: revision, summary: "Cancelled" }, "agent", AbortSignal.abort())).rejects.toBeDefined();
    expect(value).toBe(committed);
  } finally {
    for (const runtime of runtimes) runtime.lifecycle.stop();
    read.mockRestore(); barrier.mockRestore(); write.mockRestore();
  }
});
