import { describe, expect, test } from "bun:test";
import { createTinyFishClient, publicWebUrl } from "./tinyfish";
import type { AgentFetch } from "../models/transport";
import { fetchInputUrl } from "../models/transport";

const key = "test-secret-never-returned";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
describe("TinyFish provider boundary", () => {
  test("search sends only supported fields, authenticates privately, and enforces domain constraints", async () => {
    let seen: URL | undefined;
    const client = createTinyFishClient(key, async (url, init) => {
      seen = new URL(fetchInputUrl(url));
      expect(new Headers(init?.headers).get("X-API-Key")).toBe(key);
      expect(init?.redirect).toBe("error");
      return json({
        query: "test",
        results: [
          { title: "Wrong domain", url: "https://example.org", snippet: "irrelevant" },
          { title: "Subdomain", url: "https://docs.example.com/test", snippet: "a".repeat(1000) },
          { title: "Spoofed suffix", url: "https://notexample.com", snippet: "untrusted" },
        ],
      });
    });
    const result = await client.search({
      query: "  test 中 & text  ",
      domains: ["example.com"],
      recencyDays: 2,
      limit: 1,
      language: "zh",
    });
    expect(seen!.searchParams.get("query")).toBe("test 中 & text");
    expect(seen!.searchParams.get("recency_minutes")).toBe("2880");
    expect(seen!.searchParams.get("include_domains")).toBe("example.com");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].snippet).toHaveLength(800);
    expect(JSON.stringify(result)).not.toContain(key);
  });

  test("search shares the other providers' rules: script-tagged languages and duplicate sources", async () => {
    let seen: URL | undefined;
    const client = createTinyFishClient(key, async (url) => {
      seen = new URL(fetchInputUrl(url));
      return json({
        results: [
          { title: "One", url: "https://example.com/a", snippet: "first" },
          { title: "Again", url: "https://example.com/a", snippet: "duplicate" },
        ],
      });
    });
    const result = await client.search({ query: "test", language: "zh-Hant" });
    expect(seen!.searchParams.get("language")).toBe("zh-Hant");
    expect(result.sources.map((source) => source.title)).toEqual(["One"]);
  });

  test("fetch bounds output, supports continuation, and declares cache freshness", async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = createTinyFishClient(key, async (_url, init) => {
      bodies.push(JSON.parse(init?.body as string));
      return json({
        results: [
          {
            url: "https://example.com/",
            final_url: "https://example.com/article",
            title: "Page",
            text: "a".repeat(1300),
          },
        ],
        errors: [],
      });
    });
    const first = await client.fetch({ url: "https://example.com", maxChars: 500 });
    expect(first).toMatchObject({
      text: "a".repeat(500),
      offset: 0,
      nextOffset: 500,
      finalUrl: "https://example.com/article",
    });
    const rest = await client.fetch({ url: "https://example.com", offset: 500, maxChars: 1000, fresh: true });
    expect(rest.text).toHaveLength(800);
    expect(rest.nextOffset).toBeNull();
    expect(bodies.map((body) => body.ttl)).toEqual([3600, 0]);
    expect(bodies[0]).toEqual({
      urls: ["https://example.com/"],
      format: "markdown",
      ttl: 3600,
      per_url_timeout_ms: 45000,
    });
  });

  test("HTTP and per-URL failures cannot masquerade as empty successes or leak upstream secrets", async () => {
    for (const [status, code] of [
      [401, "auth"],
      [402, "access"],
      [429, "rate-limited"],
      [503, "provider"],
    ] as const) {
      const client = createTinyFishClient(key, async () => json({ message: key }, status));
      const error = await client.search({ query: "test" }).catch((error) => error);
      expect(error.code).toBe(`search/${code}`);
      expect(error.message).not.toContain(key);
    }
    for (const error of ["login_required", "bot_blocked", "page_not_found", "timeout", "content_too_large"]) {
      const client = createTinyFishClient(key, async () =>
        json({ results: [], errors: [{ url: "https://example.com", error }] }),
      );
      await expect(client.fetch({ url: "https://example.com" })).rejects.toMatchObject({
        code: `search/${error === "timeout" ? "timeout" : error === "content_too_large" ? "too-large" : "fetch-failed"}`,
      });
    }
    const empty = createTinyFishClient(key, async () => json({ results: [] }));
    expect((await empty.search({ query: "test" })).sources).toEqual([]);
    await expect(
      createTinyFishClient(key, async () => json({ error: key })).search({ query: "test" }),
    ).rejects.toMatchObject({ code: "search/provider" });
  });

  test("unsafe URLs and invalid inputs never reach the transport", async () => {
    const transport: AgentFetch = async () => {
      throw new Error("must not run");
    };
    const client = createTinyFishClient(key, transport);
    for (const url of [
      "file:///etc/passwd",
      "http://localhost/a",
      "http://127.1",
      "http://2130706433",
      "http://[::1]",
      "http://169.254.169.254",
      "https://me:secret@example.com",
      "https://example.com:7890",
      "https://x.internal",
      "https://x.local.",
    ]) {
      expect(() => publicWebUrl(url)).toThrow();
      await expect(client.fetch({ url })).rejects.toMatchObject({ code: "search/invalid-input" });
    }
    await expect(client.search({ query: " " })).rejects.toMatchObject({ code: "search/invalid-input" });
    await expect(client.search({ query: "test", limit: 0 })).rejects.toMatchObject({ code: "search/invalid-input" });
    await expect(client.fetch({ url: "https://example.com", maxChars: 12001 })).rejects.toMatchObject({
      code: "search/invalid-input",
    });
  });

  test("cancellation propagates through transport and oversized responses stop reading", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | null | undefined;
    const client = createTinyFishClient(key, async (_url, init) => {
      requestSignal = init?.signal;
      controller.abort();
      requestSignal?.throwIfAborted();
      throw new Error("unreachable");
    });
    await expect(client.search({ query: "test" }, controller.signal)).rejects.toMatchObject({
      code: "search/cancelled",
    });
    expect(requestSignal?.aborted).toBe(true);
    let cancelled = false;
    const big = createTinyFishClient(
      key,
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(4_000_001));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    );
    await expect(big.fetch({ url: "https://example.com" })).rejects.toMatchObject({ code: "search/too-large" });
    expect(cancelled).toBe(true);
  });
});
