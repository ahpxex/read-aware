import { describe, expect, test } from "bun:test";
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { CustomOpenAIAccount } from "./accounts";
import { createModelResolver } from "./accounts";
import { createCompleteFn } from "./complete";
import {
  CUSTOM_OPENAI_PROVIDER_ID,
  createCustomOpenAIModel,
  normalizeCustomOpenAIBaseUrl,
  sanitizeCustomOpenAIPayload,
  type CustomOpenAIApi,
} from "./custom-openai";
import { buildProviderRegistry } from "./registry";
import { testLlmConnection } from "./test-connection";
import { createAgentRuntime } from "../runtime/runtime";
import { createInMemoryDeps } from "../testing/fixtures";

describe("Custom OpenAI-compatible models", () => {
  test("uses the configured model metadata instead of cloning a catalog model", () => {
    const resolveModel = createModelResolver(
      {
        kind: "api-key",
        provider: CUSTOM_OPENAI_PROVIDER_ID,
        apiKey: "test-key",
        baseUrl: "https://gateway.example/v1",
        api: "openai-completions",
      },
      { smart: "gpt-5.6-sol", fast: "gpt-5.6-luna" },
    );

    expect(resolveModel("smart")).toMatchObject({
      id: "gpt-5.6-sol",
      name: "gpt-5.6-sol",
      api: "openai-completions",
      provider: CUSTOM_OPENAI_PROVIDER_ID,
      baseUrl: "https://gateway.example/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
    expect(resolveModel("fast").id).toBe("gpt-5.6-luna");
  });

  test("only keeps an output cap when the user configured one", () => {
    const payload = {
      model: "gateway-model",
      store: false,
      max_tokens: 8_192,
      max_completion_tokens: 8_192,
      max_output_tokens: 8_192,
      prompt_cache_key: "session",
      prompt_cache_retention: "24h",
      prompt_cache_options: { mode: "explicit" },
      include: ["reasoning.encrypted_content"],
    };

    expect(sanitizeCustomOpenAIPayload(payload)).toEqual({
      model: "gateway-model",
    });
    expect(sanitizeCustomOpenAIPayload(payload, 8_192)).toEqual({
      model: "gateway-model",
      max_tokens: 8_192,
      max_completion_tokens: 8_192,
      max_output_tokens: 8_192,
    });
  });

  test("marks thinking support and the explicit output cap in model metadata", () => {
    expect(
      createCustomOpenAIModel("gateway-model", {
        baseUrl: "https://gateway.example/v1",
        api: "openai-responses",
        supportsThinking: true,
        maxOutputTokens: 4_096,
      }),
    ).toMatchObject({
      reasoning: true,
      maxTokens: 4_096,
    });
  });

  test("accepts SDK base URLs and pasted endpoint URLs", () => {
    expect(
      normalizeCustomOpenAIBaseUrl(
        " https://gateway.example/v1/chat/completions/ ",
      ),
    ).toBe("https://gateway.example/v1");
    expect(
      normalizeCustomOpenAIBaseUrl(
        "https://gateway.example/v1/responses?api-version=latest#fragment",
      ),
    ).toBe("https://gateway.example/v1?api-version=latest");
    expect(normalizeCustomOpenAIBaseUrl("https://gateway.example/v1/")).toBe(
      "https://gateway.example/v1",
    );
  });

  test("downlevels tool schemas to the common OpenAPI-compatible subset", () => {
    const payload = sanitizeCustomOpenAIPayload({
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            parameters: {
              type: "object",
              properties: {
                mode: { const: "exact" },
                term: {
                  anyOf: [{ type: "string" }, { type: "null" }],
                },
                source: {
                  anyOf: [{ const: "book" }, { const: "notes" }],
                },
                labels: {
                  type: "object",
                  patternProperties: { ".*": { type: "string" } },
                },
              },
              unevaluatedProperties: false,
            },
          },
        },
      ],
    }) as Record<string, unknown>;

    expect(payload.tools).toEqual([
      {
        type: "function",
        function: {
          name: "lookup",
          parameters: {
            type: "object",
            properties: {
              mode: { enum: ["exact"] },
              term: { type: "string", nullable: true },
              source: { type: "string", enum: ["book", "notes"] },
              labels: {
                type: "object",
                additionalProperties: { type: "string" },
              },
            },
            additionalProperties: false,
          },
        },
      },
    ]);
  });
});

type CapturedRequest = {
  path: string;
  body: Record<string, unknown>;
};

async function captureRejectedRequest(
  api: CustomOpenAIApi,
  maxOutputTokens?: number,
): Promise<{ request: CapturedRequest; error: Error }> {
  let captured: CapturedRequest | undefined;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      captured = {
        path: new URL(request.url).pathname,
        body: (await request.json()) as Record<string, unknown>,
      };
      return Response.json(
        { error: { message: "gateway rejected this request" } },
        { status: 422 },
      );
    },
  });
  const account: CustomOpenAIAccount = {
    kind: "api-key",
    provider: CUSTOM_OPENAI_PROVIDER_ID,
    apiKey: "test-key",
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    api,
    maxOutputTokens,
  };

  try {
    let error: Error | undefined;
    try {
      await testLlmConnection(account, "gpt-5.6-sol");
    } catch (cause) {
      error = cause instanceof Error ? cause : new Error(String(cause));
    }
    if (!captured || !error) {
      throw new Error("expected the gateway request to fail");
    }
    return { request: captured, error };
  } finally {
    server.stop(true);
  }
}

async function withCompletionSse<T>(
  body: string,
  run: (account: CustomOpenAIAccount) => Promise<T>,
  contentType = "text/event-stream",
): Promise<T> {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response(body, {
        headers: { "Content-Type": contentType },
      });
    },
  });
  const account: CustomOpenAIAccount = {
    kind: "api-key",
    provider: CUSTOM_OPENAI_PROVIDER_ID,
    apiKey: "test-key",
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    api: "openai-completions",
  };

  try {
    return await run(account);
  } finally {
    server.stop(true);
  }
}

describe("Custom OpenAI-compatible wire format", () => {
  test("uses Chat Completions and omits inferred compatibility fields", async () => {
    const { request, error } = await captureRejectedRequest(
      "openai-completions",
    );

    expect(request.path).toBe("/v1/chat/completions");
    expect(request.body.model).toBe("gpt-5.6-sol");
    expect(request.body.messages).toBeArray();
    expect(request.body).not.toHaveProperty("store");
    expect(request.body).not.toHaveProperty("max_tokens");
    expect(request.body).not.toHaveProperty("max_completion_tokens");
    expect(request.body).not.toHaveProperty("stream_options");
    expect(error.message).toContain("422");
    expect(error.message).toContain("gateway rejected this request");
  });

  test("uses Responses and strips optional first-party fields", async () => {
    const { request, error } = await captureRejectedRequest(
      "openai-responses",
    );

    expect(request.path).toBe("/v1/responses");
    expect(request.body.model).toBe("gpt-5.6-sol");
    expect(request.body.input).toBeArray();
    expect(request.body).not.toHaveProperty("store");
    expect(request.body).not.toHaveProperty("max_output_tokens");
    expect(request.body).not.toHaveProperty("prompt_cache_key");
    expect(request.body).not.toHaveProperty("prompt_cache_retention");
    expect(error.message).toContain("422");
    expect(error.message).toContain("gateway rejected this request");
  });

  test("sends an explicit output cap with the selected format", async () => {
    const { request } = await captureRejectedRequest(
      "openai-completions",
      4_096,
    );

    expect(request.body.max_tokens).toBe(4_096);
  });

  test("accepts an explicit DONE sentinel when a gateway omits finish_reason", async () => {
    const body = [
      'data: {"id":"chat-1","object":"chat.completion.chunk","model":"gateway-model","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
      "",
      'data: {"id":"chat-1","object":"chat.completion.chunk","model":"gateway-model","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const result = await withCompletionSse(body, (account) =>
      testLlmConnection(account, "gateway-model"),
    );

    expect(result).toBe("ok");
  });

  test("accepts SSE when the gateway sends the wrong content type", async () => {
    const body = [
      'data: {"id":"chat-plain","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"end_turn"}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const result = await withCompletionSse(
      body,
      (account) => testLlmConnection(account, "gateway-model"),
      "text/plain",
    );

    expect(result).toBe("ok");
  });

  test("accepts a complete JSON response when streaming is ignored", async () => {
    const body = JSON.stringify({
      id: "chat-json",
      object: "chat.completion",
      model: "gateway-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "ok" }],
          },
          finish_reason: null,
        },
      ],
    });

    const result = await withCompletionSse(
      body,
      (account) => testLlmConnection(account, "gateway-model"),
      "application/json",
    );

    expect(result).toBe("ok");
  });

  test("infers toolUse when a DONE-only gateway streamed a tool call", async () => {
    const body = [
      'data: {"id":"chat-tool","object":"chat.completion.chunk","model":"gateway-model","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"lookup","arguments":""}}]},"finish_reason":null}]}',
      "",
      'data: {"id":"chat-tool","object":"chat.completion.chunk","model":"gateway-model","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\\"term\\\":\\\"Ulysses\\\"}"}}]},"finish_reason":null}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const message = await withCompletionSse(body, async (account) => {
      const registry = buildProviderRegistry();
      const resolveModel = createModelResolver(
        account,
        { smart: "gateway-model", fast: "gateway-model" },
        registry,
      );
      const complete = createCompleteFn(registry, account);
      return complete(resolveModel("smart"), {
        messages: [
          {
            role: "user",
            content: "Look up Ulysses.",
            timestamp: Date.now(),
          },
        ],
        tools: [
          {
            name: "lookup",
            description: "Look up a term",
            parameters: Type.Object({ term: Type.String() }),
          },
        ],
      });
    });

    expect(message.stopReason).toBe("toolUse");
    expect(message.content).toContainEqual({
      type: "toolCall",
      id: "call-1",
      name: "lookup",
      arguments: { term: "Ulysses" },
    });
  });

  test("normalizes legacy tool calls with missing ids and object arguments", async () => {
    const body = [
      'data: {"id":"chat-legacy-tool","choices":[{"delta":{"function_call":{"name":"lookup","arguments":{"term":"Ulysses"}}},"finish_reason":"tool_use"}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const message = await withCompletionSse(body, async (account) => {
      const registry = buildProviderRegistry();
      const resolveModel = createModelResolver(
        account,
        { smart: "gateway-model", fast: "gateway-model" },
        registry,
      );
      const complete = createCompleteFn(registry, account);
      return complete(resolveModel("smart"), {
        messages: [
          {
            role: "user",
            content: "Look up Ulysses.",
            timestamp: Date.now(),
          },
        ],
        tools: [
          {
            name: "lookup",
            description: "Look up a term",
            parameters: Type.Object({ term: Type.String() }),
          },
        ],
      });
    });

    expect(message.stopReason).toBe("toolUse");
    expect(message.content).toContainEqual({
      type: "toolCall",
      id: expect.stringMatching(/^call_/),
      name: "lookup",
      arguments: { term: "Ulysses" },
    });
  });

  test("does not hide a truncated stream without the DONE sentinel", async () => {
    const body = [
      'data: {"id":"chat-cut","object":"chat.completion.chunk","model":"gateway-model","choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}',
      "",
    ].join("\n");

    await expect(
      withCompletionSse(body, (account) =>
        testLlmConnection(account, "gateway-model"),
      ),
    ).rejects.toThrow("Stream ended without finish_reason");
  });

  test("uses the same compatibility adapter in the real agent loop", async () => {
    const requests: Record<string, unknown>[] = [];
    const body = [
      'data: {"id":"chat-agent","object":"chat.completion.chunk","model":"gateway-model","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        requests.push((await request.json()) as Record<string, unknown>);
        return new Response(body, {
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    });
    const account: CustomOpenAIAccount = {
      kind: "api-key",
      provider: CUSTOM_OPENAI_PROVIDER_ID,
      apiKey: "test-key",
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      api: "openai-completions",
    };
    const schemaProbe: AgentTool = {
      name: "schema_probe",
      label: "Schema probe",
      description: "A test-only tool with a literal parameter.",
      parameters: Type.Object({ mode: Type.Literal("exact") }),
      execute: async () => ({
        content: [{ type: "text", text: "ok" }],
        details: {},
      }),
    };
    const { deps } = createInMemoryDeps();
    deps.extraTools = () => [schemaProbe];
    let nativeFetchCalls = 0;
    const runtime = createAgentRuntime({
      deps,
      account,
      models: { smart: "gateway-model", fast: "gateway-model" },
      fetch: (input, init) => {
        nativeFetchCalls += 1;
        return globalThis.fetch(input, init);
      },
    });

    try {
      const chunks = [];
      for await (const chunk of runtime.sendTurn(
        { kind: "global", threadId: "custom-provider-test" },
        { text: "Say ok." },
      )) {
        chunks.push(chunk);
      }
      await runtime.flushBackgroundWork();

      expect(
        chunks
          .filter((chunk) => chunk.type === "text")
          .map((chunk) => chunk.text)
          .join(""),
      ).toBe("ok");
      expect(nativeFetchCalls).toBeGreaterThan(0);
      const tools = requests[0]?.tools as
        | Array<{
            function?: {
              name?: string;
              parameters?: { properties?: Record<string, unknown> };
            };
          }>
        | undefined;
      const probe = tools?.find((tool) => tool.function?.name === "schema_probe");
      expect(probe?.function?.parameters?.properties?.mode).toEqual({
        type: "string",
        enum: ["exact"],
      });
    } finally {
      server.stop(true);
    }
  });
});
