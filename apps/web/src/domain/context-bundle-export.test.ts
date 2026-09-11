import { expect, test } from "bun:test";
import { createContextBundle, RESOURCE_MAX_CHUNK, type ContextBundle } from "@read-aware/core";
import { ResourceOwner, type ResourceAdapter } from "../services/resource-owner";
import type { ContextResourceAccess } from "../services/resource-access";
import { saveResourceFile } from "../platform/resource-save";
import { exportContextBundle } from "./context-bundle-export";

function fixture() {
  const files = new Map<string, Uint8Array>(), sealed = new Set<string>(), errors: unknown[] = [];
  const revoke = new AbortController();
  let sequence = 0, disposed = 0, allowed = true, writes = 0, now = 0;
  const adapter: ResourceAdapter = {
    pick: async () => [], openBook: async () => null, openCover: async () => null,
    create: async options => {
      const id = `native-${++sequence}`; files.set(id, new Uint8Array());
      return { id, size: 0, name: options.name, mimeType: options.mimeType! };
    },
    append: async (id, offset, bytes) => {
      expect(sealed.has(id)).toBe(false); expect(files.get(id)!.length).toBe(offset);
      const next = new Uint8Array(offset + bytes.length); next.set(files.get(id)!); next.set(bytes, offset);
      files.set(id, next); return next.length;
    },
    commit: async id => { sealed.add(id); },
    commitContext: async (id, revision) => {
      expect(revision).toBe(`cbsource1:${"a".repeat(32)}:1`); sealed.add(id);
    },
    read: async (id, offset, length) => files.get(id)!.slice(offset, offset + length).buffer,
    save: (id, filename, signal, beforeWrite) => saveResourceFile(async () => filename, async () => {
      expect(sealed.has(id)).toBe(true); writes++;
    }, signal, beforeWrite),
    copyImage: async () => { throw Error("Unexpected image copy"); },
    imagePreview: async () => { throw Error("Unexpected image decode"); },
    release: async id => { files.delete(id); sealed.delete(id); },
  };
  const access: ContextResourceAccess = { sourceRevision: `cbsource1:${"a".repeat(32)}:1`,
    signal: revoke.signal, isAllowed: () => allowed, dispose: () => { disposed++; } };
  const owner = new ResourceOwner(adapter, error => errors.push(error), () => {}, () => now);
  return { owner, adapter, files, sealed, errors, access, revoke,
    deny: () => { allowed = false; }, time: (value: number) => { now = value; },
    get disposed() { return disposed; }, get writes() { return writes; } };
}
function artifact(text = "A grounded profile"): Promise<ContextBundle> {
  return createContextBundle({ format: "readaware.context", schemaVersion: 1, recipeVersion: 1,
    kind: "user_profile_context", scope: { kind: "user" }, sourceRevision: "pctx1:test",
    items: [{ kind: "curated_profile", id: "profile", revision: "pctx1:test", label: "Profile", text }], omissions: [] });
}

test("export seals the exact copied artifact and returns only an actor-local read-only reference", async () => {
  const f = fixture(), other = fixture(), bundle = await artifact(), expected = structuredClone(bundle);
  try {
    const pending = exportContextBundle(f.owner, bundle, f.access);
    bundle.content.items[0]!.text = "mutated"; bundle.version = "mutated";
    const ref = await pending;
    expect(ref).toMatchObject({ source: "context", state: "ready", mimeType: "application/json" });
    expect(ref.name).toBe(`${expected.content.kind}-${expected.version.slice(4)}.json`);
    expect(ref.id).not.toStartWith("native-"); expect(f.sealed.size).toBe(1);
    const bytes = (await f.owner.read(ref.id, 0, RESOURCE_MAX_CHUNK)).data;
    expect(new TextDecoder().decode(bytes)).toBe(`${JSON.stringify(expected)}\n`);
    await expect(other.owner.read(ref.id, 0, 1)).rejects.toMatchObject({ code: "fs/not-found" });
    await expect(f.owner.append(ref.id, ref.size, new Uint8Array([0]))).rejects.toMatchObject({ code: "ui/invalid-target" });
    await expect(f.owner.use(ref.id, async () => { throw Error("Must not dispatch"); })).rejects.toMatchObject({ code: "ui/invalid-target" });
    await expect(f.owner.copyImage(ref.id)).rejects.toMatchObject({ code: "ui/invalid-target" });
    await expect(f.owner.imagePreview(ref.id)).rejects.toMatchObject({ code: "ui/invalid-target" });
    f.adapter.commit = async () => { throw Error("Already sealed"); };
    expect(await f.owner.commit(ref.id)).toEqual(ref);
    expect(await f.owner.save(ref.id)).toEqual({ saved: true }); expect(f.writes).toBe(1);
    await f.owner.release(ref.id); await f.owner.release(ref.id);
    expect(f.disposed).toBe(1); expect(f.files.size).toBe(0);
  } finally { await f.owner.dispose(); await other.owner.dispose(); }
});

test("current authority is checked at every entry point and after native byte reads", async () => {
  const f = fixture();
  try {
    const ref = await exportContextBundle(f.owner, await artifact(), f.access);
    const originalRead = f.adapter.read;
    f.adapter.read = async (...args) => { const bytes = await originalRead(...args); f.deny(); return bytes; };
    await expect(f.owner.read(ref.id, 0, 1)).rejects.toMatchObject({ code: "memory/forbidden" });
    for (const operation of [() => f.owner.stat(ref.id), () => f.owner.read(ref.id, 0, 1),
      () => f.owner.commit(ref.id), () => f.owner.save(ref.id), () => f.owner.copyImage(ref.id),
      () => f.owner.imagePreview(ref.id), () => f.owner.use(ref.id, async () => null),
      () => f.owner.append(ref.id, ref.size, new Uint8Array())]) {
      await expect(operation()).rejects.toMatchObject({ code: "memory/forbidden" });
    }
    expect(f.writes).toBe(0);
    await f.owner.release(ref.id); expect(f.disposed).toBe(1);
  } finally { await f.owner.dispose(); }
});

test("revocation suppresses in-flight bytes, removes native files and disposes observers once", async () => {
  const f = fixture(), gate = Promise.withResolvers<ArrayBuffer>();
  try {
    const ref = await exportContextBundle(f.owner, await artifact(), f.access);
    f.adapter.read = () => gate.promise;
    const reading = f.owner.read(ref.id, 0, 1).catch(error => error);
    await Bun.sleep(0); f.revoke.abort(Error("Policy changed"));
    gate.resolve(new ArrayBuffer(1)); expect(await reading).toMatchObject({ message: "Policy changed" });
    await f.owner.release(ref.id);
    expect(f.files.size).toBe(0); expect(f.disposed).toBe(1);
    await expect(f.owner.stat(ref.id)).rejects.toMatchObject({ code: "fs/not-found" });
  } finally { await f.owner.dispose(); }
  expect(f.disposed).toBe(1);
});

test("failed validation, denial, cancellation, sealing and late native acquisition clean their owned lease", async () => {
  for (const failure of ["invalid", "denied", "cancelled", "seal", "create", "append"] as const) {
    const f = fixture(), abort = new AbortController(), bundle = await artifact();
    try {
      if (failure === "invalid") bundle.version = `cb1:${"0".repeat(64)}`;
      if (failure === "denied") f.deny();
      if (failure === "cancelled") abort.abort(Error("Cancelled"));
      if (failure === "seal") f.adapter.commitContext = async () => { throw Error("Seal failed"); };
      if (failure === "append") f.adapter.append = async () => 999;
      if (failure === "create") {
        const create = f.adapter.create;
        f.adapter.create = async options => { const value = await create(options); f.revoke.abort(); return value; };
      }
      await expect(exportContextBundle(f.owner, bundle, f.access, abort.signal)).rejects.toBeDefined();
      expect(f.files.size).toBe(0); expect(f.disposed).toBe(1); expect(f.writes).toBe(0);
    } finally { await f.owner.dispose(); }
    expect(f.disposed).toBe(1);
  }
});

test("save rechecks policy, cancellation, expiry and owner retirement after its dialog", async () => {
  for (const reason of ["policy", "cancel", "expiry", "retire"] as const) {
    const f = fixture(), abort = new AbortController(), dialog = Promise.withResolvers<string | null>();
    let writes = 0, retirement: Promise<void> | undefined;
    try {
      const ref = await exportContextBundle(f.owner, await artifact(), f.access);
      f.adapter.save = (_id, _name, signal, check) => saveResourceFile(() => dialog.promise, async () => { writes++; }, signal, check);
      const saving = f.owner.save(ref.id, undefined, abort.signal).catch(error => error);
      await Bun.sleep(0);
      if (reason === "policy") f.deny();
      if (reason === "cancel") abort.abort();
      if (reason === "expiry") f.time(ref.expiresAt);
      if (reason === "retire") retirement = f.owner.dispose();
      dialog.resolve("chosen.json");
      expect(await saving).toBeInstanceOf(Error); expect(writes).toBe(0);
      await retirement;
    } finally { await f.owner.dispose(); }
  }
});

test("a dispatched external save drains its real receipt even after revocation and retirement", async () => {
  const f = fixture(), write = Promise.withResolvers<void>(), abort = new AbortController();
  let dispatched = false;
  try {
    const ref = await exportContextBundle(f.owner, await artifact(), f.access);
    f.adapter.save = (_id, _name, signal, check) => saveResourceFile(async () => "chosen.json", () => {
      dispatched = true; return write.promise;
    }, signal, check);
    const saving = f.owner.save(ref.id, undefined, abort.signal);
    await Bun.sleep(0); expect(dispatched).toBe(true);
    const retiring = f.owner.dispose(); f.revoke.abort(); abort.abort();
    expect(f.files.size).toBe(1);
    write.resolve(); expect(await saving).toEqual({ saved: true });
    await retiring; expect(f.files.size).toBe(0); expect(f.disposed).toBe(1);
  } finally { await f.owner.dispose(); }
});

test("native cleanup failures are logged, cannot restore disclosure and are retryable by release", async () => {
  const f = fixture();
  try {
    const ref = await exportContextBundle(f.owner, await artifact(), f.access), release = f.adapter.release;
    f.adapter.release = async () => { throw Error("Cleanup failed"); };
    f.revoke.abort(); await Bun.sleep(0);
    expect(f.errors).toHaveLength(1); expect(f.disposed).toBe(1);
    await expect(f.owner.read(ref.id, 0, 1)).rejects.toBeDefined();
    f.adapter.release = release; await f.owner.release(ref.id);
    expect(f.files.size).toBe(0); expect(f.disposed).toBe(1);
  } finally { await f.owner.dispose(); }
});

test("context JSON may cross chunk boundaries without truncation or exposing a writer", async () => {
  const f = fixture();
  try {
    const bundle = await createContextBundle({ format: "readaware.context", schemaVersion: 1, recipeVersion: 1,
      kind: "user_profile_context", scope: { kind: "user" }, sourceRevision: "large",
      items: Array.from({ length: 512 }, (_, index) => ({ kind: "memory", id: String(index), revision: "v1", label: "", text: "x".repeat(2000) })), omissions: [] });
    const ref = await exportContextBundle(f.owner, bundle, f.access);
    expect(ref.size).toBeGreaterThan(RESOURCE_MAX_CHUNK);
    const first = await f.owner.read(ref.id, 0, RESOURCE_MAX_CHUNK);
    const second = await f.owner.read(ref.id, first.nextOffset, RESOURCE_MAX_CHUNK);
    expect(first.eof).toBe(false); expect(second.eof).toBe(true);
    expect(new TextDecoder().decode(new Uint8Array([...new Uint8Array(first.data), ...new Uint8Array(second.data)])))
      .toBe(`${JSON.stringify(bundle)}\n`);
  } finally { await f.owner.dispose(); }
});

test("rejected acquisition transfers and cleans its lease without calling the loader", async () => {
  for (const reason of ["quota", "retired", "queued-cancel"] as const) {
    const f = fixture(), abort = new AbortController(), gate = Promise.withResolvers<void>();
    let loaded = false, holding: Promise<unknown> | undefined;
    try {
      if (reason === "quota") for (let i = 0; i < 16; i++) await f.owner.create({ name: "file" });
      if (reason === "retired") await f.owner.dispose();
      if (reason === "queued-cancel") {
        const ref = await f.owner.create({ name: "hold" }); await f.owner.commit(ref.id);
        holding = f.owner.use(ref.id, () => gate.promise); await Bun.sleep(0);
      }
      const pending = f.owner.importContext(async () => { loaded = true; return { name: "context.json", bytes: new Uint8Array() }; }, f.access, abort.signal).catch(error => error);
      if (reason === "queued-cancel") abort.abort();
      gate.resolve(); await holding;
      expect(await pending).toBeInstanceOf(Error); expect(loaded).toBe(false); expect(f.disposed).toBe(1);
    } finally { gate.resolve(); await f.owner.dispose(); }
  }
});

test("revocation cleanup cannot be refused by a saturated actor queue", async () => {
  const f = fixture(), gate = Promise.withResolvers<ArrayBuffer>();
  try {
    const ref = await exportContextBundle(f.owner, await artifact(), f.access);
    f.adapter.read = () => gate.promise;
    const read = f.owner.read(ref.id, 0, 1).catch(error => error);
    await Bun.sleep(0);
    const queued = Array.from({ length: 31 }, () => f.owner.stat(ref.id).catch(error => error));
    await expect(f.owner.stat(ref.id)).rejects.toMatchObject({ code: "ui/unavailable" });
    f.revoke.abort(); gate.resolve(new ArrayBuffer(1));
    expect(await read).toBeInstanceOf(Error);
    expect((await Promise.all(queued)).every(result => result instanceof Error)).toBe(true);
    await Bun.sleep(0); expect(f.files.size).toBe(0); expect(f.disposed).toBe(1);
  } finally { gate.resolve(new ArrayBuffer(1)); await f.owner.dispose(); }
});

test("native source binding is mandatory, copied before queueing and cannot fall back to generic sealing", async () => {
  for (const mode of ["copied", "invalid", "native-conflict"] as const) {
    const f = fixture();
    try {
      f.adapter.commit = async () => { throw Error("Generic seal must not be used"); };
      if (mode === "invalid") f.access.sourceRevision = "cb1:not-a-source-proof";
      if (mode === "native-conflict") f.adapter.commitContext = async () => { throw new Error("Native source changed"); };
      const pending = exportContextBundle(f.owner, await artifact(), f.access);
      f.access.sourceRevision = "changed-after-call";
      if (mode === "copied") {
        const ref = await pending;
        expect(ref.state).toBe("ready");
        await f.owner.release(ref.id);
      } else {
        await expect(pending).rejects.toBeDefined();
      }
      expect(f.files.size).toBe(0); expect(f.disposed).toBe(1);
    } finally { await f.owner.dispose(); }
  }
});
