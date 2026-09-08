import { expect, test } from "bun:test";
import { flattenPluginRequest, flattenPluginResponse, restorePluginResponse } from "./plugin-network-wire";

test("Request input preserves method, headers, binary body and overrides", async () => {
  const request = new Request("https://example.test/resource", { method: "PUT", headers: { authorization: "test", "content-type": "application/octet-stream" }, body: new Uint8Array([0, 255, 10]) });
  const wire = await flattenPluginRequest(request, { headers: { "x-override": "yes" } });
  expect(wire.init.method).toBe("PUT");
  expect(new Headers(wire.init.headers).get("x-override")).toBe("yes");
  expect(new Headers(wire.init.headers).has("authorization")).toBe(false);
  expect([...new Uint8Array(wire.init.body!)]).toEqual([0, 255, 10]);
});

test("FormData gets the matching multipart boundary and URLSearchParams gets native encoding", async () => {
  const data = new FormData(); data.set("title", "A & B");
  const form = await flattenPluginRequest("https://example.test/", { method: "POST", body: data });
  const decoded = await new Response(form.init.body, { headers: form.init.headers }).formData();
  expect(decoded.get("title")).toBe("A & B");
  const params = await flattenPluginRequest(new URL("https://example.test/"), { method: "POST", body: new URLSearchParams({ title: "A & B" }) });
  expect(new TextDecoder().decode(params.init.body)).toBe("title=A+%26+B");
});

test("a Request's already-aborted signal fails before dispatch", async () => {
  const controller = new AbortController(); controller.abort(new Error("cancelled before call"));
  await expect(flattenPluginRequest(new Request("https://example.test/", { signal: controller.signal }))).rejects.toThrow("cancelled before call");
});

test("cancellation during a response body read cancels the underlying stream", async () => {
  let cancelled = false;
  const controller = new AbortController();
  const pending = flattenPluginResponse(new Response(new ReadableStream({ cancel() { cancelled = true; } })), controller.signal).catch(error => error);
  controller.abort(new Error("stop read"));
  expect((await pending).message).toBe("stop read");
  expect(cancelled).toBe(true);
});

test("oversized responses fail with a stable code and release their stream", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); }, cancel() { cancelled = true; } });
  const error = await flattenPluginResponse(new Response(stream), undefined, 2).catch(error => error);
  expect(error.code).toBe("plugin/payload-too-large"); expect(cancelled).toBe(true);
});

test("binary response, empty response and redirect URL survive the round trip", async () => {
  const response = new Response(new Uint8Array([0, 255]), { headers: { "x-test": "yes" } });
  Object.defineProperty(response, "url", { value: "https://example.test/final" });
  const restored = restorePluginResponse(await flattenPluginResponse(response));
  expect(restored.url).toBe("https://example.test/final");
  expect(restored.headers.get("x-test")).toBe("yes");
  expect([...new Uint8Array(await restored.arrayBuffer())]).toEqual([0, 255]);
  expect(restorePluginResponse(await flattenPluginResponse(new Response(null, { status: 204 }))).body).toBeNull();
});
