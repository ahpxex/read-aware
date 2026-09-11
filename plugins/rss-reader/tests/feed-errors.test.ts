import { expect, test } from "bun:test";
import type { RssPluginContext } from "../src/types";
import { fetchFeed } from "../src/feed";

test("HTTP errors retain status-specific codes and dispose the rejected response", async () => {
  const cases = [[401, "auth"], [403, "auth"], [404, "not-found"], [410, "not-found"],
    [429, "rate-limited"], [500, "server"], [503, "server"], [400, "rejected"], [302, "rejected"]] as const;
  for (const [status, suffix] of cases) {
    let disposed = false;
    const ctx = { services: { network: { fetch: async () => new Response(new ReadableStream({ cancel() { disposed = true; } }), { status }) } } } as unknown as RssPluginContext;
    await expect(fetchFeed(ctx, "https://example.test/feed")).rejects.toMatchObject({
      code: `plugin/http-${suffix}`, retryable: status === 429 || status >= 500,
    });
    expect(disposed).toBe(true);
  }
});

test("RSS preserves classified host failures without pretending there was an HTTP response", async () => {
  for (const code of ["plugin/network-failed", "plugin/network-timeout", "plugin/cancelled", "plugin/network-denied"]) {
    const error = Object.assign(new Error("Host detail"), { code });
    const ctx = { services: { network: { fetch: async () => { throw error; } } } } as unknown as RssPluginContext;
    await expect(fetchFeed(ctx, "https://example.test/feed")).rejects.toBe(error);
  }
});
