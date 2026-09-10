import { afterEach, expect, test } from "bun:test";
import type { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import { validateManifest } from "../lib/manifest";
import { parsePluginNetworkAccess } from "../lib/plugin-network-policy";
import { PluginLifecycleController } from "./plugin-lifecycle";
import { createPluginNetworkService } from "./plugin-network";
import { flattenPluginResponse, restorePluginResponse } from "./plugin-network-wire";
import { buildPluginContext } from "./plugin-context";
import { PLUGIN_NETWORK_LIMITS } from "./plugin-network-requests";

const lifecycles: PluginLifecycleController[] = [];
afterEach(async () => {
  for (const lifecycle of lifecycles.splice(0)) { lifecycle.stop(); await lifecycle.drainCleanups(); }
});

test("native transport has no shared cookie feature and shipped network manifests opt in explicitly", async () => {
  const cargo = Bun.TOML.parse(await Bun.file(new URL("../../../../../desktop/src-tauri/Cargo.toml", import.meta.url)).text()) as {
    dependencies: Record<string, { "default-features"?: boolean; features?: string[] }>;
  };
  const http = cargo.dependencies["tauri-plugin-http"]!;
  expect(http["default-features"]).toBe(false);
  expect(http.features).not.toContain("cookies");
  for (const id of ["rss-reader", "tts", "webdav-sync"]) {
    const manifest = validateManifest(await Bun.file(new URL(`../../../../../../plugins/${id}/manifest.json`, import.meta.url)).json());
    expect(manifest.networkAccess?.origins).toEqual(["*"]);
    expect(manifest.requires.services?.network).toBe("^2.0.0");
  }
});

function harness(origins = ["https://a.test"], respond: (url: string, init: Parameters<typeof nativeFetch>[1], index: number) => Response | Promise<Response> = () => new Response("ok")) {
  const calls: { url: string; init: Parameters<typeof nativeFetch>[1] }[] = [];
  const lifecycle = new PluginLifecycleController([]);
  lifecycles.push(lifecycle);
  lifecycle.promote();
  const service = createPluginNetworkService({ origins }, lifecycle, async (input, init) => {
    const index = calls.length;
    calls.push({ url: String(input), init: { ...init, headers: new Headers(init?.headers) } });
    return respond(String(input), init, index);
  });
  return { service, calls, lifecycle };
}

test("manifest scopes are explicit, bounded, canonical and incompatible with pre-policy hosts", () => {
  const base = { id: "network-test", name: "Network", version: "1", schemaVersion: 1,
    permissions: ["service:network"], requires: { services: { network: "^2.0.0" } } };
  expect(validateManifest({ ...base, networkAccess: { origins: ["https://a.test/", "https://a.test", "http://[::1]:8080"] } }).networkAccess)
    .toEqual({ origins: ["https://a.test", "http://[::1]:8080"] });
  expect(parsePluginNetworkAccess(undefined)).toEqual({ origins: [] });
  expect(parsePluginNetworkAccess({ origins: ["*"] })).toEqual({ origins: ["*"] });
  for (const origins of [["https://*.test"], ["https://a.test/path"], ["https://a.test?x"], ["https://a.test/#fragment"],
    ["https://user:pass@a.test"], ["file:///tmp/a"], ["*", "https://a.test"], ["https://a.test:443"], Array(33).fill("https://a.test")]) {
    expect(() => validateManifest({ ...base, networkAccess: { origins } })).toThrow(/networkAccess/);
  }
  for (const networkAccess of [null, [], {}, { origins: [], extra: true }, { origins: [4] }]) {
    expect(() => validateManifest({ ...base, networkAccess })).toThrow(/networkAccess/);
  }
  for (const network of [undefined, "^1.1.0", "*", ">=1", "^1 || ^2"]) {
    expect(() => validateManifest({ ...base, requires: { services: network ? { network } : {} }, networkAccess: { origins: [] } })).toThrow(/networkAccess/);
  }
  expect(() => validateManifest({ ...base, permissions: [], networkAccess: { origins: [] } })).toThrow(/service:network/);
});

test("permission does not imply destinations; policy and manifest cannot widen an activation", async () => {
  const base = { id: "network-grants", name: "Network", version: "1", schemaVersion: 1, requires: {} };
  const absent = buildPluginContext(base, "0.5.4", []);
  const granted = buildPluginContext({ ...base, permissions: ["service:network"] }, "0.5.4", []);
  try {
    expect(absent.context.services.network).toBeUndefined();
    granted.lifecycle.promote();
    expect((await granted.context.services.network!.policy()).origins).toEqual([]);
    await expect(granted.context.services.network!.fetch("https://a.test")).rejects.toMatchObject({ code: "plugin/network-denied" });
  } finally { absent.lifecycle.stop(); granted.lifecycle.stop(); }
  const origins = ["https://a.test"];
  const h = harness(origins);
  origins.push("https://b.test");
  const snapshot = await h.service.policy(); snapshot.origins.push("https://c.test");
  expect(await h.service.policy()).toEqual({ origins: ["https://a.test"], maxRedirects: 10, maxBodyBytes: 64 * 1024 * 1024, ...PLUGIN_NETWORK_LIMITS });
  for (const url of ["https://b.test", "https://c.test", "http://a.test", "https://a.test:8080", "https://sub.a.test", "file:///tmp/a"]) {
    await expect(h.service.fetch(url)).rejects.toMatchObject({ code: "plugin/network-denied" });
  }
  expect(h.calls).toHaveLength(0);
  h.lifecycle.stop();
  expect(() => h.service.fetch("https://a.test")).toThrow();
  await expect(h.service.policy()).rejects.toThrow();
});

test("every native hop is scoped, disables automatic redirects and drops caller TLS/proxy options", async () => {
  let released = 0;
  const h = harness(["https://a.test"], () => new Response(new ReadableStream({ cancel() { released++; } }), {
    status: 302, headers: { location: "https://b.test/steal" },
  }));
  await expect(h.service.fetch("https://a.test", { maxRedirections: 100, danger: { acceptInvalidCerts: true }, proxy: { all: "http://evil.test" },
    headers: { host: "b.test", "content-length": "123" } } as RequestInit)).rejects.toMatchObject({ code: "plugin/network-denied" });
  expect(h.calls).toHaveLength(1);
  expect(h.calls[0]!.init?.maxRedirections).toBe(0);
  expect(h.calls[0]!.init?.danger).toBeUndefined();
  expect(h.calls[0]!.init?.proxy).toBeUndefined();
  expect(new Headers(h.calls[0]!.init?.headers).has("host")).toBe(false);
  expect(new Headers(h.calls[0]!.init?.headers).has("content-length")).toBe(false);
  expect(released).toBe(1);
});

test("stream methods consume the same authoritative origin gate and preserve non-success responses", async () => {
  const h = harness(["https://a.test"], () => new Response(new Uint8Array([0, 255, 2]), { status: 404, headers: { "x-test": "stream" } }));
  await expect(h.service.openStream("https://outside.test")).rejects.toMatchObject({ code: "plugin/network-denied" });
  expect(h.calls).toHaveLength(0);
  const stream = await h.service.openStream("https://a.test");
  expect(stream.status).toBe(404); expect(new Headers(stream.headers).get("x-test")).toBe("stream");
  const chunk = await h.service.readStream(stream.id, 0, 2);
  expect([...new Uint8Array(chunk.bytes)]).toEqual([0, 255]);
  await h.service.closeStream(stream.id);
  await expect(h.service.readStream(stream.id, 2)).rejects.toMatchObject({ code: "plugin/network-closed" });
});

test("allowed redirects replay 307 bytes and strip cross-origin standard credentials", async () => {
  const h = harness(["https://a.test", "https://b.test"], (url, _init, index) => {
    const response = index === 0 ? new Response(null, { status: 307, headers: { location: "https://b.test/final" } }) : new Response("result");
    Object.defineProperty(response, "url", { value: url }); return response;
  });
  const response = await h.service.fetch(new Request("https://a.test", { method: "PUT", body: new Uint8Array([0, 255]),
    headers: { authorization: "secret", "proxy-authorization": "proxy", cookie: "cookie", referer: "https://private.test", "content-type": "application/octet-stream", "x-public": "ok" } }));
  expect(h.calls).toHaveLength(2);
  const init = h.calls[1]!.init!;
  expect(init.method).toBe("PUT"); expect([...new Uint8Array(init.body as ArrayBuffer)]).toEqual([0, 255]);
  const headers = new Headers(init.headers);
  for (const name of ["authorization", "proxy-authorization", "cookie", "referer"]) expect(headers.has(name)).toBe(false);
  expect(headers.get("x-public")).toBe("ok"); expect(headers.get("content-type")).toBe("application/octet-stream");
  const restored = restorePluginResponse(await flattenPluginResponse(response));
  expect(restored.url).toBe("https://b.test/final"); expect(restored.redirected).toBe(true);
  expect(await restored.text()).toBe("result");
});

test("same-origin POST 302 becomes GET, preserves auth and clears body headers", async () => {
  const h = harness(undefined, (_url, _init, index) => index === 0 ? new Response(null, { status: 302, headers: { location: "/next" } }) : new Response(null, { status: 204 }));
  await h.service.fetch("https://a.test/start", { method: "POST", body: "hello", headers: { authorization: "secret" } });
  const { url, init } = h.calls[1]!;
  expect(url).toBe("https://a.test/next"); expect(init?.method).toBe("GET"); expect(init?.body).toBeUndefined();
  expect(new Headers(init?.headers).get("authorization")).toBe("secret");
  expect(new Headers(init?.headers).has("content-type")).toBe(false);
});

test("manual/error, loops, unsupported redirect schemes and HTTPS downgrades never escape", async () => {
  for (const mode of ["manual", "error"] as const) {
    const h = harness(undefined, () => new Response(null, { status: 302, headers: { location: "https://outside.test" } }));
    if (mode === "manual") expect((await h.service.fetch("https://a.test", { redirect: mode })).status).toBe(302);
    else await expect(h.service.fetch("https://a.test", { redirect: mode })).rejects.toMatchObject({ code: "plugin/network-redirect" });
    expect(h.calls).toHaveLength(1);
  }
  const loop = harness(undefined, () => new Response(null, { status: 301, headers: { location: "/loop" } }));
  await expect(loop.service.fetch("https://a.test")).rejects.toMatchObject({ code: "plugin/network-redirect" });
  expect(loop.calls).toHaveLength(11);
  for (const location of ["file:///tmp/a", "https://user:pass@a.test", "http://a.test"]) {
    const h = harness(["*"], () => new Response(null, { status: 308, headers: { location } }));
    await expect(h.service.fetch("https://a.test")).rejects.toMatchObject({ code: "plugin/network-denied" });
    expect(h.calls).toHaveLength(1);
  }
});

test("pre-cancel, in-flight cancellation and retirement prevent subsequent hops", async () => {
  const before = new AbortController(); before.abort(new Error("cancelled"));
  const h = harness();
  await expect(h.service.fetch(new Request("https://a.test", { signal: before.signal }))).rejects.toThrow("cancelled");
  expect(h.calls).toHaveLength(0);
  for (const stop of [false, true]) {
    const controller = new AbortController();
    let release!: (value: Response) => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const next = harness(undefined, () => { started(); return new Promise(resolve => { release = resolve; }); });
    const pending = next.service.fetch("https://a.test", { signal: controller.signal });
    await ready;
    if (stop) next.lifecycle.stop(); else controller.abort(new Error("cancelled"));
    release(new Response(null, { status: 302, headers: { location: "/next" } }));
    await expect(pending).rejects.toThrow(); expect(next.calls).toHaveLength(1);
  }
});
