import { afterEach, describe, expect, test } from "bun:test";
import { ModelCatalogStore, MODEL_CATALOG_TTL_MS } from "./catalog-store";
import { parseCatalogModels, type CatalogModel } from "./catalog-data";
import { buildProviderRegistry, setModelCatalogReader } from "./registry";
import { createModelResolver } from "./accounts";
import { createCompleteFn } from "./complete";
import type { AgentFetch } from "./transport";

const provider = "zai-coding-cn";
function model(id = "glm-future"): CatalogModel {
  return {
    id, name: id, api: "openai-completions", provider,
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4", reasoning: true,
    input: ["text"], contextWindow: 1_000_000, maxTokens: 131_072,
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    thinkingLevelMap: { low: "low", high: "high", max: "max", off: null },
    compat: { thinkingFormat: "zai", maxTokensField: "max_tokens", supportsReasoningEffort: true },
  };
}

function setup(fetch: AgentFetch, options: { selected?: string[]; timeoutMs?: number } = {}) {
  const disk = new Map<string, string>();
  const warnings: unknown[] = [];
  let now = 10_000_000;
  let failWrite = false;
  const deps = {
    fetch, read: (id: string) => disk.get(id) ?? null,
    write: async (id: string, value: string) => {
      if (failWrite) throw new Error("disk locked");
      disk.set(id, value);
    },
    selected: () => options.selected ?? [],
    log: { warn: (_message: string, error: unknown) => { warnings.push(error); } },
    now: () => now,
    timeoutMs: options.timeoutMs,
  };
  return {
    store: new ModelCatalogStore(deps), disk, warnings, deps,
    advance: (ms: number) => { now += ms; },
    failWrite: () => { failWrite = true; },
  };
}

afterEach(() => setModelCatalogReader(() => []));

describe("remote model catalog", () => {
  test("starts without any bundled inventory and persists a validated remote catalog", async () => {
    let requests = 0;
    const kit = setup(async (url, init) => {
      requests++;
      expect(String(url)).toBe("https://pi.dev/api/models/providers/zai-coding-cn");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return Response.json({ future: model() }, { headers: { ETag: '"catalog-1"' } });
    });
    expect(kit.store.getSnapshot(provider).models).toEqual([]);
    expect(buildProviderRegistry().getModels(provider)).toEqual([]);
    await kit.store.refresh(provider);
    expect(kit.store.getSnapshot(provider).models[0]).toEqual(model());
    await kit.store.refresh(provider);
    expect(requests).toBe(1);
    const restored = new ModelCatalogStore(kit.deps);
    expect(restored.getSnapshot(provider).models).toEqual([model()]);
    expect(restored.getSnapshot(provider).checkedAt).toBeDefined();
  });

  test("uses ETags after four hours and supports forced refresh", async () => {
    let calls = 0;
    const kit = setup(async (_url, init) => {
      calls++;
      if (calls === 1) return Response.json([model()], { headers: { ETag: '"v1"' } });
      expect(new Headers(init?.headers).get("if-none-match")).toBe('"v1"');
      return new Response(null, { status: 304 });
    });
    await kit.store.refresh(provider);
    const first = kit.store.getSnapshot(provider).checkedAt;
    kit.advance(MODEL_CATALOG_TTL_MS);
    await kit.store.refresh(provider);
    expect(calls).toBe(2);
    expect(kit.store.getSnapshot(provider).checkedAt).toBeGreaterThan(first!);
    expect(kit.store.getSnapshot(provider).models).toEqual([model()]);
    await kit.store.refresh(provider, true);
    expect(calls).toBe(3);
  });

  test("deduplicates overlapping picker and scheduler requests", async () => {
    let finish!: (value: Response) => void;
    let calls = 0;
    const kit = setup(() => { calls++; return new Promise((resolve) => { finish = resolve; }); });
    const first = kit.store.refresh(provider);
    const second = kit.store.refresh(provider, true);
    expect(first).toBe(second);
    expect(kit.store.getSnapshot(provider).refreshing).toBe(true);
    finish(Response.json([model()]));
    await first;
    expect(calls).toBe(1);
    expect(kit.store.getSnapshot(provider).refreshing).toBe(false);
  });

  test("keeps a removed selection's capabilities without keeping retired models in the picker", async () => {
    let response = [model("chosen"), model("old")];
    const selected = ["chosen"];
    const kit = setup(async () => Response.json(response), { selected });
    await kit.store.refresh(provider);
    setModelCatalogReader(kit.store.getModels);
    const registry = buildProviderRegistry();
    const resolve = createModelResolver({ kind: "api-key", provider, apiKey: "not-sent" }, { smart: "chosen", fast: "chosen" }, registry);
    expect(resolve("smart")).toEqual(model("chosen"));
    response = [model("new")];
    await kit.store.refresh(provider, true);
    expect(selected).toEqual(["chosen"]);
    expect(kit.store.getSnapshot(provider).models.map((entry) => entry.id)).toEqual(["new"]);
    expect(resolve("smart")).toEqual(model("chosen"));
    expect(registry.getModels(provider).map((entry) => entry.id)).toEqual(["new", "chosen"]);
    expect(new ModelCatalogStore(kit.deps).getModels(provider)).toEqual([model("new"), model("chosen")]);
  });

  test("an existing resolver sees refreshed metadata without changing its chosen ID", async () => {
    let current = model();
    const kit = setup(async () => Response.json([current]));
    setModelCatalogReader(kit.store.getModels);
    const resolve = createModelResolver({ kind: "api-key", provider, apiKey: "" }, { smart: current.id, fast: current.id });
    await kit.store.refresh(provider);
    expect(resolve("smart").maxTokens).toBe(131_072);
    current = { ...current, maxTokens: 200_000 };
    await kit.store.refresh(provider, true);
    expect(resolve("smart").id).toBe(current.id);
    expect(resolve("smart").maxTokens).toBe(200_000);
  });

  test("remote descriptors drive the real SDK transport, including credentials and reasoning", async () => {
    const kit = setup(async () => Response.json([model()]));
    await kit.store.refresh(provider);
    setModelCatalogReader(kit.store.getModels);
    const registry = buildProviderRegistry();
    const account = { kind: "api-key", provider, apiKey: "test-key" } as const;
    const resolve = createModelResolver(account, { smart: "glm-future", fast: "glm-future" }, registry);
    let request: Record<string, unknown> | undefined;
    const complete = createCompleteFn(registry, account, "high", async (url, init) => {
      expect(String(url)).toBe("https://open.bigmodel.cn/api/coding/paas/v4/chat/completions");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
      request = JSON.parse(String(init?.body));
      return new Response([
        'data: {"id":"test","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}',
        'data: {"id":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        'data: [DONE]', "",
      ].join("\n\n"), { headers: { "content-type": "text/event-stream" } });
    });
    const result = await complete(resolve("smart"), { messages: [{ role: "user", content: "hello", timestamp: 0 }] });
    expect(result.stopReason).toBe("stop");
    expect(result.content).toContainEqual({ type: "text", text: "ok" });
    expect(request).toMatchObject({ model: "glm-future", thinking: { type: "enabled" }, reasoning_effort: "high" });
  });

  test("an uncatalogued manual selection never borrows another model's capabilities", () => {
    setModelCatalogReader(() => [{ ...model(), input: ["text", "image"] }]);
    const resolve = createModelResolver({ kind: "api-key", provider, apiKey: "" }, { smart: "manual-id", fast: "" });
    expect(resolve("smart")).toMatchObject({ id: "manual-id", reasoning: false, input: ["text"] });
    expect(() => resolve("fast")).toThrow();
  });

  test.each(["network", "empty", "malformed", "http"])("%s failure preserves the cache and reports failure, with retry backoff", async (failure) => {
    let fail = false;
    let calls = 0;
    const kit = setup(async () => {
      calls++;
      if (!fail) return Response.json([model()]);
      if (failure === "network") throw new Error("offline");
      if (failure === "http") return new Response(null, { status: 503 });
      return Response.json(failure === "empty" ? [] : [{ id: "broken" }]);
    });
    await kit.store.refresh(provider);
    const disk = kit.disk.get(provider);
    fail = true;
    kit.advance(MODEL_CATALOG_TTL_MS);
    await kit.store.refresh(provider);
    expect(kit.store.getSnapshot(provider).models).toEqual([model()]);
    expect(kit.store.getSnapshot(provider).error).toBeDefined();
    expect(kit.disk.get(provider)).toBe(disk);
    await kit.store.refresh(provider);
    expect(calls).toBe(2);
    expect(kit.warnings).toHaveLength(1);
  });

  test("a first-load failure is not a successful empty list", async () => {
    const kit = setup(async () => { throw new Error("offline"); });
    await kit.store.refresh(provider);
    expect(kit.store.getSnapshot(provider)).toMatchObject({ models: [], refreshing: false });
    expect(kit.store.getSnapshot(provider).error).toBeDefined();
    expect(kit.store.getSnapshot(provider).checkedAt).toBeUndefined();
  });

  test("a cache write failure does not publish a non-durable update", async () => {
    let response = [model()];
    const kit = setup(async () => Response.json(response));
    await kit.store.refresh(provider);
    response = [model("new")];
    kit.failWrite();
    await kit.store.refresh(provider, true);
    expect(kit.store.getSnapshot(provider).models).toEqual([model()]);
    expect(kit.store.getSnapshot(provider).error).toBeDefined();
  });

  test("corrupt cache is reported and replaced on a successful refresh", async () => {
    const kit = setup(async () => Response.json([model()]));
    kit.disk.set(provider, "{bad-json");
    expect(kit.store.getSnapshot(provider).error).toBeDefined();
    await kit.store.refresh(provider);
    expect(kit.store.getSnapshot(provider).error).toBeUndefined();
    expect(kit.warnings).toHaveLength(1);
  });

  test("Ollama uses its public discovery endpoint without built-in IDs", async () => {
    const kit = setup(async (url) => {
      expect(String(url)).toBe("https://ollama.com/v1/models");
      return Response.json({ data: [{ id: "new-ollama-model" }] });
    });
    await kit.store.refresh("ollama-cloud");
    expect(kit.store.getSnapshot("ollama-cloud").models[0]).toMatchObject({ id: "new-ollama-model", provider: "ollama-cloud" });
  });

  test("times out even when transport ignores cancellation, and never publishes a late response", async () => {
    let finish!: (response: Response) => void;
    const kit = setup(() => new Promise((resolve) => { finish = resolve; }), { timeoutMs: 5 });
    await kit.store.refresh(provider);
    expect(kit.store.getSnapshot(provider).refreshing).toBe(false);
    expect(kit.store.getSnapshot(provider).error).toBeDefined();
    finish(Response.json([model()]));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(kit.disk.size).toBe(0);
    expect(kit.store.getSnapshot(provider).models).toEqual([]);
  });

  test("never forwards catalog-supplied destinations or headers", () => {
    expect(parseCatalogModels(provider, [{ ...model(), baseUrl: "https://attacker.invalid", headers: { Authorization: "injected" } }])[0]).toEqual(model());
    expect(parseCatalogModels("openrouter", [{ ...model(), provider: "openrouter", api: "anthropic-messages" }])[0].baseUrl).toBe("https://openrouter.ai/api");
  });

  test("accepts unknown routing prices without negative spend, preserving tiered pricing", () => {
    const [parsed] = parseCatalogModels(provider, [{ ...model(), cost: {
      input: -1_000_000, output: -1_000_000, cacheRead: 0, cacheWrite: 0,
      tiers: [{ inputTokensAbove: 200_000, input: 2, output: 4, cacheRead: 1, cacheWrite: 2 }],
    } }]);
    expect(parsed.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
      tiers: [{ inputTokensAbove: 200_000, input: 2, output: 4, cacheRead: 1, cacheWrite: 2 }],
    });
  });

  test("rejects invalid model contracts rather than guessing another model's capabilities", () => {
    for (const patch of [{ provider: "openai" }, { api: "unknown-api" }, { input: ["audio"] }, { contextWindow: 0 }, { cost: {} }, { thinkingLevelMap: { high: {} } }]) {
      expect(() => parseCatalogModels(provider, [{ ...model(), ...patch }])).toThrow();
    }
    expect(() => parseCatalogModels(provider, [model(), model()])).toThrow();
  });
});
