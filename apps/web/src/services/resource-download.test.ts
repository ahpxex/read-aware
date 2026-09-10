import { expect, test } from "bun:test";
import { RESOURCE_DOWNLOAD_MAX_BYTES } from "@read-aware/core";
import { ResourceOwner, type ResourceAdapter } from "./resource-owner";
import { ResourceDownloadService } from "./resource-download";

function files() {
  const data = new Map<string, Uint8Array>(); let next = 0, failWrite = false;
  const adapter: ResourceAdapter = {
    pick: async () => [], openBook: async () => null, openCover: async () => null,
    create: async input => { const id = `file-${++next}`; data.set(id, new Uint8Array()); return { id, size: 0, name: input.name, mimeType: input.mimeType! }; },
    append: async (id, offset, bytes) => { if (failWrite) throw new Error("Write failed"); const value = new Uint8Array(offset + bytes.length); value.set(data.get(id)!); value.set(bytes, offset); data.set(id, value); return value.length; },
    commit: async () => {}, save: async () => true,
    read: async (id, offset, length) => data.get(id)!.slice(offset, offset + length).buffer,
    release: async id => { data.delete(id); }, copyImage: async () => ({ copied: true, width: 1, height: 1 }), imagePreview: async () => new ArrayBuffer(0),
  };
  const owner = new ResourceOwner(adapter, error => { throw error; });
  return { owner, data, failWrite: () => { failWrite = true; } };
}
const request = { url: "https://example.com/book.txt", name: "book.txt" };

test("download uses credential-free manual GET, streams into the existing resource owner and seals", async () => {
  const f = files(); const errors: unknown[] = [];
  const service = new ResourceDownloadService(async (input, init) => {
    expect(input).toBe(request.url); expect(init?.method).toBe("GET"); expect(init?.credentials).toBe("omit");
    expect([...new Headers(init?.headers)]).toEqual([]); expect(init?.maxRedirections).toBe(0);
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("first")); c.enqueue(new TextEncoder().encode("second")); c.close(); } }), { headers: { "content-type": "text/plain; charset=utf-8" } });
  }, () => f.owner, error => errors.push(error));
  try {
    const result = await service.download("global:thread", request);
    expect(result.status).toBe("downloaded");
    if (result.status !== "downloaded") throw new Error("Expected resource");
    expect(result.resource).toMatchObject({ name: "book.txt", mimeType: "text/plain", size: 11, state: "ready", source: "created" });
    const content = await f.owner.read(result.resource.id, 0, 100);
    expect(new TextDecoder().decode(content.data)).toBe("firstsecond"); expect(errors).toEqual([]);
  } finally { await f.owner.dispose(); }
});

test("redirects and HTTP failures do not create files or silently request another URL", async () => {
  const f = files(); let calls = 0;
  const service = new ResourceDownloadService(async () => { calls++; return new Response(null, { status: 302, headers: { location: "https://cdn.example.com/book.txt" } }); }, () => f.owner, () => {});
  try {
    expect(await service.download("global:thread", request)).toEqual({ status: "redirect", httpStatus: 302, url: "https://cdn.example.com/book.txt" });
    expect(calls).toBe(1); expect(f.data.size).toBe(0);
    const missing = new ResourceDownloadService(async () => new Response("missing", { status: 404 }), () => f.owner, () => {});
    expect(await missing.download("global:thread", request)).toEqual({ status: "http-error", httpStatus: 404 });
    const unsafe = new ResourceDownloadService(async () => new Response(null, { status: 302, headers: { location: "http://example.com/plain" } }), () => f.owner, () => {});
    await expect(unsafe.download("global:thread", request)).rejects.toMatchObject({ code: "plugin/network-denied" });
  } finally { await f.owner.dispose(); }
});

test("oversize responses and failed writes release temporary data", async () => {
  const f = files();
  try {
    const declared = new ResourceDownloadService(async () => new Response(null, { headers: { "content-length": String(RESOURCE_DOWNLOAD_MAX_BYTES + 1) } }), () => f.owner, () => {});
    await expect(declared.download("global:thread", request)).rejects.toMatchObject({ code: "plugin/payload-too-large" });
    expect(f.data.size).toBe(0);
    const streamed = new ResourceDownloadService(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(RESOURCE_DOWNLOAD_MAX_BYTES + 1)); c.close(); } })), () => f.owner, () => {});
    await expect(streamed.download("global:thread", request)).rejects.toMatchObject({ code: "plugin/payload-too-large" });
    expect(f.data.size).toBe(0);
    f.failWrite(); const broken = new ResourceDownloadService(async () => new Response("data"), () => f.owner, () => {});
    await expect(broken.download("global:thread", request)).rejects.toThrow("Write failed"); expect(f.data.size).toBe(0);
  } finally { await f.owner.dispose(); }
});

test("one download per conversation and four overall retain slots until cancelled native work settles", async () => {
  const f = files(); let resolve!: (value: Response) => void;
  const native = new Promise<Response>(done => { resolve = done; });
  const service = new ResourceDownloadService(async () => { await native; return new Response("late"); }, () => f.owner, () => {});
  const controller = new AbortController();
  const first = service.download("global:one", request, controller.signal);
  const outcome = first.catch(error => error);
  try {
    await new Promise(done => setTimeout(done, 0));
    await expect(service.download("global:one", request)).rejects.toMatchObject({ code: "plugin/network-busy" });
    controller.abort(new Error("Cancelled"));
    await new Promise(done => setTimeout(done, 0));
    await expect(service.download("global:one", request)).rejects.toMatchObject({ code: "plugin/network-busy" });
    resolve(new Response("late")); expect((await outcome).message).toBe("Cancelled"); expect(f.data.size).toBe(0);
    const pending = ["one", "two", "three", "four"].map(id => service.download(`global:${id}`, request));
    await expect(service.download("global:five", request)).rejects.toMatchObject({ code: "plugin/network-busy" });
    await Promise.all(pending);
  } finally { resolve(new Response(null)); await outcome; await f.owner.dispose(); }
});
