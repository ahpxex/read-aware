import { expect, test } from "bun:test";
import { PluginImageOwner, pluginImageOwner, registerPluginImageOwner } from "./plugin-image-owner";
import { decodePluginCallbacks, PluginCallbackRegistry } from "../runtime/plugin-callback-wire";
import { normalizePluginView } from "./plugin-view";

function fixture(load: (id: string, signal: AbortSignal) => Promise<Blob> = async () => new Blob(["pixels"], { type: "image/png" })) {
  const created: string[] = [], revoked: string[] = [];
  const owner = new PluginImageOwner(load, {
    createObjectURL: () => { const url = `blob:private-${created.length}`; created.push(url); return url; },
    revokeObjectURL: url => { revoked.push(url); },
  });
  return { owner, created, revoked };
}
test("image render leases coalesce within an owner and release the private URL only after the last consumer", async () => {
  let loads = 0;
  const f = fixture(async () => { loads++; return new Blob(["pixels"], { type: "image/png" }); });
  const first = new AbortController(), second = new AbortController();
  const a = await f.owner.acquire("image", first.signal), b = await f.owner.acquire("image", second.signal);
  expect(loads).toBe(1); expect(a.url).toBe(b.url); expect(f.created).toHaveLength(1);
  first.abort(); expect(f.revoked).toEqual([]);
  b.release(); b.release(); expect(f.revoked).toEqual([a.url]);
  const c = await f.owner.acquire("image", new AbortController().signal);
  expect(loads).toBe(2); f.owner.dispose(); expect(f.revoked).toEqual([a.url, c.url]);
  await expect(f.owner.acquire("image", new AbortController().signal)).rejects.toMatchObject({ code: "plugin/unavailable" });
});
test("pending previews cancel promptly, suppress late URLs and allow retry after decoder failure", async () => {
  let finish!: (blob: Blob) => void;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.owner.acquire("image", new AbortController().signal);
  await Promise.resolve(); f.owner.dispose();
  await expect(pending).rejects.toMatchObject({ code: "plugin/unavailable" });
  finish(new Blob(["late"], { type: "image/png" })); await Promise.resolve(); await Promise.resolve();
  expect(f.created).toEqual([]);
  let fail = true;
  const retry = fixture(async () => { if (fail) throw Error("decode"); return new Blob(["ok"], { type: "image/png" }); });
  await expect(retry.owner.acquire("image", new AbortController().signal)).rejects.toThrow("decode");
  fail = false;
  const lease = await retry.owner.acquire("image", new AbortController().signal); lease.release(); retry.owner.dispose();
  expect(retry.revoked).toHaveLength(1);
});
test("view image budgets bound distinct leases, preview payload bytes and content type", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 16; i++) await f.owner.acquire(String(i), new AbortController().signal);
    await expect(f.owner.acquire("overflow", new AbortController().signal)).rejects.toMatchObject({ code: "ui/unavailable" });
  } finally { f.owner.dispose(); }
  expect(f.revoked).toHaveLength(16);
  const big = fixture(async () => new Blob([new Uint8Array(17 * 1024 * 1024)], { type: "image/png" }));
  try {
    for (let i = 0; i < 3; i++) await big.owner.acquire(String(i), new AbortController().signal);
    await expect(big.owner.acquire("overflow", new AbortController().signal)).rejects.toMatchObject({ code: "ui/unavailable" });
  } finally { big.owner.dispose(); }
  const unsafe = fixture(async () => new Blob(["<svg/>"], { type: "image/svg+xml" }));
  await expect(unsafe.owner.acquire("image", new AbortController().signal)).rejects.toMatchObject({ code: "ui/invalid-target" });
  unsafe.owner.dispose(); expect(unsafe.created).toEqual([]);
});
test("resource binding comes only from bridge identity and survives root, block and live normalization", async () => {
  const a = new AbortController(), b = new AbortController();
  const stopA = registerPluginImageOwner(a.signal, async () => new Blob(["A"], { type: "image/png" }));
  const stopB = registerPluginImageOwner(b.signal, async () => { throw Error("foreign resource"); });
  const registry = new PluginCallbackRegistry();
  const raw = { kind: "image", resourceId: "owned-by-a", alt: "Cover", aspectRatio: 1 };
  const wire = (value: unknown, signal: AbortSignal) => decodePluginCallbacks(structuredClone(registry.encode(value)), () => null, undefined, signal);
  try {
    expect(pluginImageOwner(normalizePluginView({ ...raw, owner: a.signal }))).toBeUndefined();
    const image = normalizePluginView(wire(raw, a.signal));
    expect(pluginImageOwner(normalizePluginView(image))).toBe(pluginImageOwner(image));
    expect(pluginImageOwner(normalizePluginView(wire({ ...raw, live: { subscribe: () => null } }, a.signal)))).toBe(pluginImageOwner(image));
    const blocks = normalizePluginView(wire({ kind: "blocks", blocks: [raw] }, a.signal));
    if (blocks.kind !== "blocks") throw Error("Expected blocks");
    expect(pluginImageOwner(blocks.blocks[0])).toBe(pluginImageOwner(image));
    await expect(pluginImageOwner(normalizePluginView(wire(raw, b.signal)))!.acquire(raw.resourceId, new AbortController().signal)).rejects.toThrow("foreign resource");
    const lease = await pluginImageOwner(image)!.acquire(raw.resourceId, new AbortController().signal);
    expect(lease.url).toStartWith("blob:"); lease.release();
    expect(JSON.stringify(image)).not.toContain("blob:");
    a.abort(); await expect(pluginImageOwner(image)!.acquire(raw.resourceId, new AbortController().signal)).rejects.toMatchObject({ code: "plugin/unavailable" });
  } finally { stopA(); stopB(); registry.clear(); }
});
test("image declarations require resource identity, alternative text and a stable bounded ratio", () => {
  const raw = { kind: "image" as const, resourceId: "id", alt: "" };
  expect(normalizePluginView(raw)).toMatchObject({ aspectRatio: 4 / 3, alt: "" });
  for (const value of [{ ...raw, resourceId: " " }, { ...raw, resourceId: "x".repeat(257) }, { ...raw, alt: undefined },
    { ...raw, aspectRatio: 0 }, { ...raw, aspectRatio: 4.1 }, { ...raw, aspectRatio: NaN }]) {
    expect(() => normalizePluginView(value)).toThrow();
  }
  expect(normalizePluginView({ ...raw, src: "https://example.com/private", html: "<img>" })).toEqual({ ...raw, aspectRatio: 4 / 3, caption: undefined, title: undefined });
});
