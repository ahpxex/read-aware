/**
 * The bundled-AI proxy: admission by tier budget, passthrough fidelity (the
 * relay must not reshape what the model said), the usage meter on both the
 * JSON and SSE paths, and the calendar-month reset. The upstream LLM is a
 * fake injected through ports.aiFetch — no network, no mocks of our own SQL.
 */
import { describe, expect, test } from "bun:test";
import type { AccountResponse } from "@read-aware/core";
import { deepseekModels, type AiModel } from "../src/ai-proxy";
import { get, login, makeRelay, post } from "./harness";

const ADMIN = "admin-secret-token";
const MODELS: AiModel[] = deepseekModels("upstream-key");

type Handle = (req: Request) => Promise<Response>;

const setTier = (handle: Handle, email: string, tier: string) =>
  handle(post("/v1/admin/tier", { email, tier }, ADMIN));

const completions = (handle: Handle, session: string, body: unknown) =>
  handle(post("/v1/ai/chat/completions", body, session));

const accountOf = async (handle: Handle, session: string): Promise<AccountResponse> =>
  (await (await handle(get("/v1/account", session))).json()) as AccountResponse;

/** A fake OpenAI-compatible upstream; records every request it saw. */
function fakeUpstream(respond: (body: Record<string, unknown>) => Response) {
  const requests: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({
      url: String(input),
      auth: new Headers(init?.headers).get("authorization"),
      body,
    });
    return respond(body);
  }) as typeof fetch;
  return { fetchFn, requests };
}

const jsonUpstream = (usage: Record<string, unknown>) =>
  fakeUpstream(
    () =>
      new Response(
        JSON.stringify({
          id: "cmpl-1",
          choices: [{ message: { role: "assistant", content: "hello" } }],
          usage,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );

/** SSE body deliberately chunked mid-line to exercise the meter's buffering. */
function sseUpstream(usage: Record<string, unknown>) {
  const text = [
    `data: {"id":"c","choices":[{"delta":{"content":"Hel"}}]}`,
    `data: {"id":"c","choices":[{"delta":{"content":"lo"}}]}`,
    `data: {"id":"c","choices":[],"usage":${JSON.stringify(usage)}}`,
    `data: [DONE]`,
    ``,
  ].join("\n\n");
  return {
    text,
    ...fakeUpstream(() => {
      const bytes = new TextEncoder().encode(text);
      const mid = Math.floor(bytes.length / 2) + 3; // splits inside a data line
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, mid));
          controller.enqueue(bytes.slice(mid));
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }),
  };
}

async function proAccount(handle: Handle, tier = "pro") {
  const { session } = await login(handle, "reader@example.com");
  await setTier(handle, "reader@example.com", tier);
  return session;
}

describe("admission", () => {
  test("answers 501 when no upstream is configured", async () => {
    const { handle } = makeRelay({ adminToken: ADMIN });
    const session = await proAccount(handle);
    const res = await completions(handle, session, { model: "deepseek-v4-flash", messages: [] });
    expect(res.status).toBe(501);
  });

  test("free tier is BYOK-only: 403, and nothing reaches the upstream", async () => {
    const { fetchFn, requests } = jsonUpstream({});
    const { handle } = makeRelay({}, {}, { models: MODELS, fetch: fetchFn });
    const { session } = await login(handle, "reader@example.com");
    const res = await completions(handle, session, { model: "deepseek-v4-flash", messages: [] });
    expect(res.status).toBe(403);
    expect(requests).toHaveLength(0);
  });

  test("the sync plan is data-only: bundled AI answers 403", async () => {
    const { fetchFn, requests } = jsonUpstream({});
    const { handle } = makeRelay({ adminToken: ADMIN }, {}, { models: MODELS, fetch: fetchFn });
    const session = await proAccount(handle, "sync");
    const res = await completions(handle, session, { model: "deepseek-v4-flash", messages: [] });
    expect(res.status).toBe(403);
    expect(requests).toHaveLength(0);
  });

  test("a model outside the catalog is refused", async () => {
    const { fetchFn } = jsonUpstream({});
    const { handle } = makeRelay({ adminToken: ADMIN }, {}, { models: MODELS, fetch: fetchFn });
    const session = await proAccount(handle);
    const res = await completions(handle, session, { model: "gpt-5.5", messages: [] });
    expect(res.status).toBe(400);
  });

  test("the models endpoint lists the catalog, default first", async () => {
    const { handle } = makeRelay({ adminToken: ADMIN }, {}, { models: MODELS });
    const { session } = await login(handle, "reader@example.com");
    const res = await handle(get("/v1/ai/models", session));
    const body = (await res.json()) as { models: { id: string; name: string }[] };
    expect(body.models.map((m) => m.id)).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
  });
});

describe("the meter", () => {
  test("a JSON completion passes through and charges the account", async () => {
    // 1M cache-miss input + 1M output on flash: $0.44 + $1.32 ⇒ 1760 credits.
    const { fetchFn, requests } = jsonUpstream({
      prompt_tokens: 1_000_000,
      completion_tokens: 1_000_000,
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 1_000_000,
    });
    const { handle } = makeRelay({ adminToken: ADMIN }, {}, { models: MODELS, fetch: fetchFn });
    const session = await proAccount(handle);
    const res = await completions(handle, session, {
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { choices: { message: { content: string } }[] };
    expect(body.choices[0].message.content).toBe("hello");

    // The upstream saw the operator's key, the upstream model id, and a capped
    // max_tokens — never the caller's session.
    expect(requests[0].auth).toBe("Bearer upstream-key");
    expect(requests[0].body.model).toBe("deepseek-v4-flash");
    expect(requests[0].body.max_tokens).toBe(32_768);

    expect((await accountOf(handle, session)).aiCreditsUsed).toBe(1760);
  });

  test("cache-hit tokens bill at the cache-hit rate", async () => {
    // 1M cache hits + 1M output: $0.014 + $1.32 = $1.334 ⇒ 1334 credits.
    const { fetchFn } = jsonUpstream({
      prompt_tokens: 1_000_000,
      completion_tokens: 1_000_000,
      prompt_cache_hit_tokens: 1_000_000,
      prompt_cache_miss_tokens: 0,
    });
    const { handle } = makeRelay({ adminToken: ADMIN }, {}, { models: MODELS, fetch: fetchFn });
    const session = await proAccount(handle);
    await completions(handle, session, { model: "deepseek-v4-flash", messages: [] });
    expect((await accountOf(handle, session)).aiCreditsUsed).toBe(1334);
  });

  test("a streamed completion passes through byte-identical and still meters", async () => {
    const upstream = sseUpstream({
      prompt_tokens: 500_000,
      completion_tokens: 250_000,
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 500_000,
    });
    const { handle, settleBackground } = makeRelay(
      { adminToken: ADMIN },
      {},
      { models: MODELS, fetch: upstream.fetchFn },
    );
    const session = await proAccount(handle);
    const res = await completions(handle, session, {
      model: "deepseek-v4-flash",
      stream: true,
      messages: [],
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(upstream.text);
    // The proxy must force the usage chunk on, or the meter goes blind.
    expect(
      (upstream.requests[0].body.stream_options as { include_usage: boolean }).include_usage,
    ).toBe(true);

    await settleBackground();
    // 0.5M miss ($0.22) + 0.25M out ($0.33) ⇒ 550 credits.
    expect((await accountOf(handle, session)).aiCreditsUsed).toBe(550);
  });
});

describe("the budget", () => {
  const expensive = {
    prompt_tokens: 0,
    completion_tokens: 4_000_000, // $5.28 on flash — blows the pro budget ($5)
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 0,
  };

  test("an exhausted month answers 402 until the calendar turns", async () => {
    const { fetchFn } = jsonUpstream(expensive);
    const { handle, advance } = makeRelay(
      { adminToken: ADMIN },
      {},
      { models: MODELS, fetch: fetchFn },
    );
    const session = await proAccount(handle);
    expect(
      (await completions(handle, session, { model: "deepseek-v4-flash", messages: [] })).status,
    ).toBe(200);
    expect(
      (await completions(handle, session, { model: "deepseek-v4-flash", messages: [] })).status,
    ).toBe(402);

    advance(32 * 24 * 60 * 60 * 1000); // a new UTC month is a new usage row
    expect(
      (await completions(handle, session, { model: "deepseek-v4-flash", messages: [] })).status,
    ).toBe(200);
  });

  test("staff is unmetered but still accounted", async () => {
    const { fetchFn } = jsonUpstream(expensive);
    const { handle } = makeRelay({ adminToken: ADMIN }, {}, { models: MODELS, fetch: fetchFn });
    const session = await proAccount(handle, "staff");
    for (let i = 0; i < 3; i++) {
      expect(
        (await completions(handle, session, { model: "deepseek-v4-flash", messages: [] })).status,
      ).toBe(200);
    }
    const account = await accountOf(handle, session);
    expect(account.limits.aiMonthlyCredits).toBeNull();
    expect(account.aiCreditsUsed).toBe(3 * 5280);
  });
});
