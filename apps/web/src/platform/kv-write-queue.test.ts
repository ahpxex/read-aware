import { describe, expect, test } from "bun:test";
import { KVWriteQueue, type KVCommit } from "./kv-write-queue";

function fixture() {
  const mirror = new Map<string, string>([["plugin.key", "original"]]);
  const disk = new Map(mirror);
  const pending: { key: string; value: string | null; resolve(): void; reject(error: Error): void }[] = [];
  const committed: unknown[] = [], origins: string[] = [], failures: unknown[] = [], failureOwners: string[] = [], transactions: KVCommit[] = [];
  const queue = new KVWriteQueue({
    read: key => mirror.get(key) ?? null,
    mirror: (key, value) => { if (value === null) mirror.delete(key); else mirror.set(key, value); },
    persist: (key, value) => new Promise<void>((resolve, reject) => pending.push({ key, value, reject, resolve: () => {
      if (value === null) disk.delete(key); else disk.set(key, value); resolve();
    } })),
    committed: (key, value, origin) => { committed.push([key, value]); origins.push(origin); },
    settled: commit => { transactions.push(commit); },
    failed: (key, error, owner) => { failures.push([key, error]); failureOwners.push(owner); },
  });
  return { queue, mirror, disk, pending, committed, origins, failures, failureOwners, transactions };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe("durable KV write queue", () => {
  test("failure presentation ownership belongs to each queued operation, not a global suppression flag", async () => {
    const f = fixture();
    let reject!: (error: Error) => void;
    const domain = f.queue.batch(new Map([["plugin.key", "domain"]]), () => new Promise<void>((_, no) => { reject = no; }), "agent", "local", "caller");
    const legacy = f.queue.write("plugin.key", "legacy");
    await tick(); reject(Error("domain failed")); await expect(domain).rejects.toThrow("domain failed");
    expect(f.mirror.get("plugin.key")).toBe("legacy");
    await tick(); f.pending[0].reject(Error("legacy failed")); await expect(legacy).rejects.toThrow("legacy failed");
    expect(f.failureOwners).toEqual(["caller", "store"]);
    expect(f.mirror.get("plugin.key")).toBe("original"); expect(f.transactions).toEqual([]);
  });
  test("transaction feed preserves actor/source, groups batch entries, includes restores and excludes failure", async () => {
    const f = fixture();
    const first = f.queue.batch(new Map([["plugin.key", "changed"], ["plugin.other", "second"]]), async () => {}, "agent");
    expect(f.transactions).toEqual([]); await first;
    expect(f.transactions).toEqual([{ source: "local", actor: "agent", entries: [{ key: "plugin.key", value: "changed" }, { key: "plugin.other", value: "second" }] }]);
    await f.queue.replace(new Map([["plugin.key", null]]), async () => {});
    expect(f.transactions[1]).toMatchObject({ source: "restore", actor: null });
    const failed = f.queue.write("plugin.key", "failed", "remote");
    await tick(); f.pending[0].reject(Error("locked")); await expect(failed).rejects.toThrow();
    expect(f.transactions).toHaveLength(2); expect(f.mirror.has("plugin.key")).toBe(false);
    const next = f.queue.write("plugin.key", "next", "remote"); await tick(); f.pending[1].resolve(); await next;
    expect(f.transactions[2]).toMatchObject({ source: "remote", actor: null });
    await f.queue.batch(new Map([["plugin.key", "backup"]]), async () => {}, null, "restore");
    expect(f.transactions[3]).toMatchObject({ source: "restore", actor: null });
    expect(f.origins[f.origins.length - 1]).toBe("local");
  });
  test("keeps synchronous reads optimistic but only publishes committed writes", async () => {
    const f = fixture(); const write = f.queue.write("plugin.key", "next");
    expect(f.mirror.get("plugin.key")).toBe("next");
    expect(f.committed).toEqual([]);
    await tick(); f.pending[0].resolve(); await write;
    expect(f.disk.get("plugin.key")).toBe("next");
    expect(f.committed).toEqual([["plugin.key", "next"]]);
  });
  test("an old failure cannot erase a newer optimistic write", async () => {
    const f = fixture(); const first = f.queue.write("plugin.key", "first"); const second = f.queue.write("plugin.key", "second");
    await tick(); expect(f.pending).toHaveLength(1);
    f.pending[0].reject(new Error("locked")); await expect(first).rejects.toThrow("locked");
    expect(f.mirror.get("plugin.key")).toBe("second");
    await tick(); f.pending[1].resolve(); await second;
    expect(f.disk.get("plugin.key")).toBe("second");
  });
  test("two failures restore the durable value, not the first failed value", async () => {
    const f = fixture(); const first = f.queue.write("plugin.key", "first"); const second = f.queue.write("plugin.key", "second");
    const flushed = f.queue.flush("plugin.").catch(error => error);
    await tick(); f.pending[0].reject(new Error("first failed")); await expect(first).rejects.toThrow();
    await tick(); f.pending[1].reject(new Error("second failed")); await expect(second).rejects.toThrow();
    expect((await flushed).message).toBe("first failed");
    expect(f.mirror.get("plugin.key")).toBe("original"); expect(f.committed).toEqual([]);
  });
  test("pending removes stay removed when an older write settles", async () => {
    const f = fixture(); const first = f.queue.write("plugin.key", "first"); const remove = f.queue.write("plugin.key", null);
    await tick(); f.pending[0].resolve(); await first;
    expect(f.mirror.has("plugin.key")).toBe(false);
    await tick(); f.pending[1].reject(new Error("remove failed")); await expect(remove).rejects.toThrow();
    expect(f.mirror.get("plugin.key")).toBe("first");
  });
  test("flush waits for durable completion and includes writes accepted while draining", async () => {
    const f = fixture(); const first = f.queue.write("plugin.key", "first");
    let complete = false; const flush = f.queue.flush("plugin.").then(() => { complete = true; });
    await tick(); expect(complete).toBe(false);
    const second = f.queue.write("plugin.other", "second"); f.pending[0].resolve(); await first;
    await tick(); expect(complete).toBe(false); f.pending[1].resolve(); await second; await flush;
    expect(f.disk.get("plugin.other")).toBe("second");
  });
  test("a namespace barrier does not wait for unrelated writes", async () => {
    const f = fixture(); const unrelated = f.queue.write("other.key", "value");
    await f.queue.flush("plugin."); await tick(); f.pending[0].resolve(); await unrelated;
  });
  test("remote origin survives asynchronous persistence between local writes", async () => {
    const f = fixture();
    const remote = f.queue.write("plugin.key", "remote", "remote");
    const local = f.queue.write("plugin.key", "local");
    await tick(); f.pending[0].resolve(); await remote;
    await tick(); f.pending[1].resolve(); await local;
    expect(f.origins).toEqual(["remote", "local"]);
  });
  test("atomic restoration is ordered before new writes and does not republish edits", async () => {
    const f = fixture();
    let finish!: () => void;
    const replacement = f.queue.replace(new Map([["plugin.key", "restored"]]), () => new Promise<void>(resolve => {
      finish = () => { f.disk.set("plugin.key", "restored"); resolve(); };
    }));
    const newer = f.queue.write("plugin.key", "newer");
    await tick(); expect(f.pending).toHaveLength(0);
    finish(); await replacement;
    expect(f.mirror.get("plugin.key")).toBe("newer");
    expect(f.committed).toEqual([]);
    await tick(); f.pending[0].reject(new Error("newer failed")); await expect(newer).rejects.toThrow();
    expect(f.mirror.get("plugin.key")).toBe("restored");
  });
  test("failed batch restores every durable key without erasing a later write", async () => {
    const f = fixture();
    const replacement = f.queue.replace(new Map([["plugin.key", null], ["plugin.other", "restored"]]), async () => {
      throw new Error("restore failed");
    });
    const newer = f.queue.write("plugin.other", "newer");
    await expect(replacement).rejects.toThrow("restore failed");
    expect(f.mirror.get("plugin.key")).toBe("original");
    expect(f.mirror.get("plugin.other")).toBe("newer");
    await tick(); f.pending[0].resolve(); await newer;
    expect(f.disk.get("plugin.other")).toBe("newer");
  });
  test("migration batches publish source deletion only after success and roll it back on failure", async () => {
    const f = fixture();
    let reject!: (error: Error) => void;
    const values = new Map<string, string | null>([["plugin.key", null], ["plugin.target", "migrated"]]);
    const failed = f.queue.batch(values, () => new Promise<void>((_, no) => { reject = no; }));
    expect(f.mirror.has("plugin.key")).toBe(false);
    expect(f.committed).toEqual([]);
    await tick(); reject(new Error("source delete failed"));
    await expect(failed).rejects.toThrow("source delete failed");
    expect(f.mirror.get("plugin.key")).toBe("original");
    expect(f.mirror.has("plugin.target")).toBe(false);
    expect(f.committed).toEqual([]);
    await f.queue.batch(values, async () => { f.disk.delete("plugin.key"); f.disk.set("plugin.target", "migrated"); });
    expect(f.committed).toEqual([["plugin.key", null], ["plugin.target", "migrated"]]);
    expect(f.origins).toEqual(["local", "local"]);
  });
  test("a synchronous batch observer cannot overwrite a newer mutation on another batch key", async () => {
    const mirror = new Map<string, string>();
    let newer: Promise<void> | undefined;
    const queue = new KVWriteQueue({
      read: key => mirror.get(key) ?? null,
      mirror: (key, value) => {
        if (value === null) mirror.delete(key); else mirror.set(key, value);
        if (key === "first" && !newer) newer = queue.write("second", "newer");
      },
      persist: async () => {}, committed: () => {}, failed: () => {},
    });
    const batch = queue.replace(new Map([["first", "batch"], ["second", "batch"]]), async () => {});
    expect(mirror.get("second")).toBe("newer");
    await batch; await newer;
    expect(mirror.get("second")).toBe("newer");
  });
});
