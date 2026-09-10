import { expect, test } from "bun:test";
import { AppError, RESOURCE_MAX_CHUNK, RESOURCE_MAX_SIZE } from "@read-aware/core";
import { ResourceOwner, type ResourceAdapter, type NativeResource } from "./resource-owner";

function fixture(authorizeBook: (id: string) => void = () => {}) {
  const files = new Map<string, Uint8Array>(), released: string[] = [], errors: unknown[] = [];
  let count = 0, now = 0;
  const make = (name = "file.bin", bytes = new Uint8Array()): NativeResource => {
    const id = `native-${++count}`; files.set(id, bytes); return { id, name, size: bytes.length, mimeType: "application/octet-stream" };
  };
  const adapter: ResourceAdapter = {
    pick: async () => [], openBook: async () => make("book.epub", new Uint8Array([1, 2, 3])),
    openCover: async () => make("cover.png", new Uint8Array([1, 2, 3])),
    copyImage: async () => ({ copied: true, width: 1, height: 1 }),
    create: async options => ({ ...make(options.name), mimeType: options.mimeType! }),
    append: async (id, offset, bytes) => {
      const previous = files.get(id)!; if (previous.length !== offset) throw Error("offset");
      const next = new Uint8Array(offset + bytes.length); next.set(previous); next.set(bytes, offset); files.set(id, next); return next.length;
    },
    read: async (id, offset, length) => new Uint8Array(files.get(id)!.slice(offset, offset + length)).buffer,
    commit: async () => {}, save: async () => false,
    release: async id => { released.push(id); files.delete(id); },
  };
  const owner = new ResourceOwner(adapter, error => errors.push(error), authorizeBook, () => now);
  return { owner, adapter, files, released, errors, make, time: (value: number) => { now = value; } };
}

test("image acquisition serializes source reads, seals chunks, checks scope and cleans failed copies", async () => {
  const f = fixture(id => { if (id !== "book") throw new AppError("memory/forbidden", "Wrong book"); });
  try {
    expect(() => f.owner.importImage("other", async () => new Blob(["pixels"]))).toThrow();
    const bytes = new Uint8Array(RESOURCE_MAX_CHUNK + 3).fill(17);
    const resource = await f.owner.importImage("book", async () => new Blob([bytes], { type: "image/png" }));
    expect(resource).toMatchObject({ source: "image", state: "ready", size: bytes.length, name: "illustration.png" });
    expect(await f.owner.read(resource!.id, RESOURCE_MAX_CHUNK, 3)).toMatchObject({ eof: true, nextOffset: bytes.length });
    await expect(f.owner.append(resource!.id, bytes.length, new Uint8Array([1]))).rejects.toMatchObject({ code: "ui/invalid-target" });
    await f.owner.release(resource!.id); expect(f.files.size).toBe(0);
    f.adapter.commit = async () => { throw new AppError("fs/permission-denied", "Cannot seal"); };
    await expect(f.owner.importImage("book", async () => new Blob(["pixels"]))).rejects.toMatchObject({ code: "fs/permission-denied" });
    expect(f.files.size).toBe(0);
    const abort = new AbortController();
    await expect(f.owner.importImage("book", async () => { abort.abort(Error("retired")); return new Blob(["pixels"]); }, abort.signal)).rejects.toThrow("retired");
    expect(f.files.size).toBe(0);
  } finally { await f.owner.dispose(); }
});

test("resource chunks are copied before queueing, offset checked, sealed and saved with honest cancellation", async () => {
  const f = fixture();
  try {
    const ref = await f.owner.create({ name: "output.bin" });
    const bytes = new Uint8Array([0, 255]); const append = f.owner.append(ref.id, 0, bytes); bytes[1] = 1;
    expect((await append).size).toBe(2);
    await expect(f.owner.append(ref.id, 0, bytes)).rejects.toMatchObject({ code: "ui/invalid-target" });
    await expect(f.owner.read(ref.id, 0, 2)).rejects.toMatchObject({ code: "ui/invalid-target" });
    await f.owner.commit(ref.id);
    expect([...new Uint8Array((await f.owner.read(ref.id, 0, 2)).data)]).toEqual([0, 255]);
    expect(await f.owner.read(ref.id, 2, 2)).toMatchObject({ eof: true, nextOffset: 2 });
    expect(await f.owner.save(ref.id)).toEqual({ saved: false });
    await expect(f.owner.read(ref.id, 0, RESOURCE_MAX_CHUNK + 1)).rejects.toMatchObject({ code: "ui/invalid-target" });
    expect(() => f.owner.save(ref.id, "../escape.bin")).toThrow();
    await f.owner.release(ref.id); await f.owner.release(ref.id);
    expect(f.files.size).toBe(0);
  } finally { await f.owner.dispose(); }
});

test("references and book authorization are owner-scoped, with quota/expiry and no native identifier disclosure", async () => {
  const a = fixture(id => { if (id !== "book") throw new AppError("memory/forbidden", "wrong book"); }), b = fixture();
  try {
    const ref = await a.owner.openBook("book"); expect(ref).not.toBeNull();
    expect(ref!.id).not.toStartWith("native-");
    await expect(b.owner.stat(ref!.id)).rejects.toMatchObject({ code: "fs/not-found" });
    expect(() => a.owner.openBook("other")).toThrow();
    a.time(ref!.expiresAt); await expect(a.owner.read(ref!.id, 0, 1)).rejects.toMatchObject({ code: "fs/not-found" });
    b.adapter.pick = async () => [{ ...b.make(), size: RESOURCE_MAX_SIZE + 1 }];
    await expect(b.owner.pick()).rejects.toMatchObject({ code: "ui/unavailable" }); expect(b.files.size).toBe(0);
    expect(await a.owner.pick()).toEqual({ cancelled: true, resources: [] });
  } finally { await a.owner.dispose(); await b.owner.dispose(); }
});

test("retirement drains accepted work, cleans late resources and does not launch queued work", async () => {
  const f = fixture(), ready = Promise.withResolvers<NativeResource>();
  f.adapter.create = () => ready.promise;
  const pending = f.owner.create({ name: "late.bin" }).then(value => value, error => error);
  await Bun.sleep(0); const queued = f.owner.create({ name: "never.bin" }).then(value => value, error => error);
  let finished = false; const draining = f.owner.dispose().then(() => { finished = true; });
  await Bun.sleep(0); expect(finished).toBe(false);
  ready.resolve(f.make()); await draining;
  expect(await pending).toMatchObject({ code: "ui/superseded" }); expect(await queued).toMatchObject({ code: "ui/superseded" });
  expect(f.files.size).toBe(0); expect(f.released).toHaveLength(1);
});

test("cancelled and failed writes never report success; export-only read policy is enforced at the owner", async () => {
  const f = fixture();
  const restricted = new ResourceOwner(f.adapter, error => f.errors.push(error), () => {}, Date.now,
    ref => { if (ref.source === "book") throw new AppError("memory/forbidden", "export only"); });
  try {
    const ref = await f.owner.create({ name: "file.bin" });
    f.adapter.append = async () => { throw Error("disk full"); };
    await expect(f.owner.append(ref.id, 0, new Uint8Array([1]))).rejects.toThrow("disk full");
    expect((await f.owner.stat(ref.id)).size).toBe(0);
    const abort = new AbortController(); abort.abort();
    await expect(f.owner.commit(ref.id, abort.signal)).rejects.toThrow();
    expect((await f.owner.stat(ref.id)).state).toBe("writing");
    const book = await restricted.openBook("book");
    await expect(restricted.read(book!.id, 0, 1)).rejects.toMatchObject({ code: "memory/forbidden" });
    expect(await restricted.save(book!.id)).toEqual({ saved: false });
  } finally { await f.owner.dispose(); await restricted.dispose(); }
});

test("native domain consumption holds the sealed resource until accepted work settles", async () => {
  const f = fixture(), gate = Promise.withResolvers<void>();
  const ref = await f.owner.create({ name: "book.txt" });
  await expect(f.owner.use(ref.id, async () => "no")).rejects.toMatchObject({ code: "ui/invalid-target" });
  await f.owner.commit(ref.id);
  let consumed = false;
  const importing = f.owner.use(ref.id, async native => {
    expect(native.id).toStartWith("native-"); await gate.promise; consumed = true; return "imported";
  }).then(value => value, error => error);
  await Bun.sleep(0);
  const retiring = f.owner.dispose(); expect(f.files.size).toBe(1);
  gate.resolve(); await retiring;
  expect(consumed).toBe(true); expect(await importing).toMatchObject({ code: "ui/superseded" });
  expect(f.files.size).toBe(0);
});

test("cover snapshots keep book authorization, isolation, null availability and retirement cleanup", async () => {
  const f = fixture(id => { if (id !== "book") throw new AppError("memory/forbidden", "wrong book"); });
  try {
    expect(() => f.owner.openCover("other")).toThrow();
    const cover = await f.owner.openCover("book");
    expect(cover).toMatchObject({ source: "cover", state: "ready", name: "cover.png" });
    expect(cover!.id).not.toStartWith("native-");
    expect(new Uint8Array((await f.owner.read(cover!.id, 0, 3)).data)).toEqual(new Uint8Array([1, 2, 3]));
    f.adapter.openCover = async () => null;
    expect(await f.owner.openCover("book")).toBeNull();
    const late = Promise.withResolvers<NativeResource>(); f.adapter.openCover = () => late.promise;
    const pending = f.owner.openCover("book").catch(error => error);
    await Bun.sleep(0); const retiring = f.owner.dispose();
    late.resolve(f.make("late.png")); await retiring;
    expect(await pending).toMatchObject({ code: "ui/superseded" }); expect(f.files.size).toBe(0);
  } finally { await f.owner.dispose(); }
});

test("image copy requires own sealed non-book resource and preserves failures and cancellation", async () => {
  const f = fixture(); let copies = 0;
  f.adapter.copyImage = async () => { copies++; return { copied: true, width: 2, height: 3 }; };
  try {
    await expect(f.owner.copyImage("foreign")).rejects.toMatchObject({ code: "fs/not-found" });
    const original = await f.owner.openBook("book");
    await expect(f.owner.copyImage(original!.id)).rejects.toMatchObject({ code: "ui/invalid-target" });
    const ref = await f.owner.create({ name: "image.png" });
    await expect(f.owner.copyImage(ref.id)).rejects.toMatchObject({ code: "ui/invalid-target" });
    await f.owner.commit(ref.id);
    await expect(f.owner.copyImage(ref.id, AbortSignal.abort())).rejects.toBeDefined(); expect(copies).toBe(0);
    expect(await f.owner.copyImage(ref.id)).toEqual({ copied: true, width: 2, height: 3 });
    expect((await f.owner.stat(ref.id)).state).toBe("ready");
    f.adapter.copyImage = async () => { throw new AppError("ui/unavailable", "clipboard"); };
    await expect(f.owner.copyImage(ref.id)).rejects.toMatchObject({ code: "ui/unavailable" });
  } finally { await f.owner.dispose(); }
});
