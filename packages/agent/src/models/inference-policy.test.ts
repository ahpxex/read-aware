import { describe, expect, test } from "bun:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { createCompleteFn, createStreamFn } from "./complete";
import { classifyModelFailure } from "./failure";
import { CUSTOM_OPENAI_PROVIDER_ID } from "./custom-openai";
import type { InferencePolicy } from "./inference-policy";
import type { ProviderRegistry } from "./registry";
import { testLlmConnection } from "./test-connection";

const account = { kind: "api-key", provider: "openai", apiKey: "test" } as const;
const model = { id: "test", provider: "openai", api: "openai-completions" } as Model<Api>;
const context = { messages: [] };
function policyState() {
  let blocked = false;
  const listeners = new Set<() => void>();
  const policy: InferencePolicy = {
    localOnly: () => blocked,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return { policy, count: () => listeners.size, set(value: boolean) { blocked = value; for (const listener of [...listeners]) listener(); } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("host inference policy", () => {
  test("blocks both model call forms before the provider is invoked", async () => {
    const state = policyState(); state.set(true);
    let calls = 0;
    const registry = { completeSimple() { calls++; }, streamSimple() { calls++; } } as unknown as ProviderRegistry;
    await expect(createCompleteFn(registry, account, undefined, undefined, state.policy)(model, context)).rejects.toMatchObject({ code: "ai/local-only", retryable: false });
    const stream = createStreamFn(registry, account, undefined, undefined, state.policy)(model, context);
    const result = await stream.result();
    expect(result.stopReason).toBe("error");
    expect(classifyModelFailure(result.errorMessage).code).toBe("ai/local-only");
    expect(calls).toBe(0); expect(state.count()).toBe(0);
  });

  test("revokes an in-flight complete call, suppresses its late answer and rejects delayed network retries", async () => {
    const state = policyState();
    const pending = deferred<ReturnType<typeof fauxAssistantMessage>>();
    let options!: SimpleStreamOptions;
    const registry = { completeSimple(_m: unknown, _c: unknown, value: SimpleStreamOptions) { options = value; return pending.promise; } } as unknown as ProviderRegistry;
    let network = 0;
    const call = createCompleteFn(registry, account, undefined, async () => { network++; return new Response("ok"); }, state.policy)(model, context);
    state.set(true);
    await expect(call).rejects.toMatchObject({ code: "ai/local-only" });
    expect(options.signal?.aborted).toBe(true);
    state.set(false);
    await expect(options.fetch!("https://provider.invalid")).rejects.toMatchObject({ code: "ai/local-only" });
    pending.resolve(fauxAssistantMessage("too late"));
    expect(network).toBe(0); expect(state.count()).toBe(0);
  });

  test("revokes a hung stream without waiting for the provider and never forwards late deltas", async () => {
    const state = policyState();
    const source = createAssistantMessageEventStream();
    let signal: AbortSignal | undefined;
    const registry = { streamSimple(_m: unknown, _c: unknown, options: SimpleStreamOptions) { signal = options.signal; return source; } } as unknown as ProviderRegistry;
    const stream = createStreamFn(registry, account, undefined, undefined, state.policy)(model, context);
    const partial = fauxAssistantMessage("first");
    source.push({ type: "text_delta", contentIndex: 0, delta: "first", partial });
    const iterator = stream[Symbol.asyncIterator]();
    const first = (await iterator.next()).value;
    expect(first?.type).toBe("text_delta");
    state.set(true);
    partial.content = [{ type: "text", text: "late mutation before abort settles" }];
    const result = await stream.result();
    expect(signal?.aborted).toBe(true);
    expect(classifyModelFailure(result.errorMessage).code).toBe("ai/local-only");
    state.set(false);
    partial.content = [{ type: "text", text: "late mutation" }];
    source.push({ type: "text_delta", contentIndex: 0, delta: "late", partial });
    source.push({ type: "done", reason: "stop", message: fauxAssistantMessage("late") });
    const rest = [];
    for (;;) { const next = await iterator.next(); if (next.done) break; rest.push(next.value.type); }
    expect(rest).toEqual(["error"]); expect(state.count()).toBe(0);
    expect(result.content).toEqual([{ type: "text", text: "first" }]);
    expect(first && "partial" in first ? first.partial.content : null).toEqual(result.content);
  });

  test("keeps caller cancellation distinct and releases listeners", async () => {
    const state = policyState();
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    const registry = { completeSimple: () => new Promise(() => {}) } as unknown as ProviderRegistry;
    const result = createCompleteFn(registry, account, undefined, undefined, state.policy)(model, context, { signal: controller.signal });
    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(state.count()).toBe(0);
  });

  test("re-enabled policy only permits new calls and normal completion releases listeners", async () => {
    const state = policyState();
    const result = fauxAssistantMessage("ok");
    const registry = {
      completeSimple: async () => result,
      streamSimple: () => { const stream = createAssistantMessageEventStream(); stream.push({ type: "done", reason: "stop", message: result }); return stream; },
    } as unknown as ProviderRegistry;
    state.set(true); state.set(false);
    expect(await createCompleteFn(registry, account, undefined, undefined, state.policy)(model, context)).toBe(result);
    expect(await createStreamFn(registry, account, undefined, undefined, state.policy)(model, context).result()).toBe(result);
    expect(state.count()).toBe(0);
  });

  test("blocks actual connection tests even with a loopback Custom provider", async () => {
    const state = policyState(); state.set(true);
    let network = 0;
    await expect(testLlmConnection({ kind: "api-key", provider: CUSTOM_OPENAI_PROVIDER_ID, apiKey: "probe", baseUrl: "http://127.0.0.1:19999/v1", api: "openai-completions" }, "probe", {
      inferencePolicy: state.policy,
      fetch: async () => { network++; return new Response("{}"); },
    })).rejects.toMatchObject({ code: "ai/local-only" });
    expect(network).toBe(0);
  });

  test("also guards a per-stream transport and preserves its SDK signal", async () => {
    const state = policyState();
    const source = createAssistantMessageEventStream();
    let options!: SimpleStreamOptions;
    let network = 0;
    let observed: AbortSignal | null | undefined;
    const transport = Object.assign(async (_input: unknown, init?: RequestInit) => {
      network++; observed = init?.signal; return new Response("ok");
    }, { preconnect() {} });
    const registry = { streamSimple(_m: unknown, _c: unknown, value: SimpleStreamOptions) { options = value; return source; } } as unknown as ProviderRegistry;
    const stream = createStreamFn(registry, account, undefined, undefined, state.policy)(model, context, { fetch: transport });
    const sdk = new AbortController();
    await options.fetch!("https://provider.invalid", { signal: sdk.signal });
    expect(observed).toBe(sdk.signal);
    state.set(true);
    await stream.result();
    state.set(false);
    await expect(options.fetch!("https://provider.invalid")).rejects.toMatchObject({ code: "ai/local-only" });
    expect(network).toBe(1); expect(state.count()).toBe(0);
    source.end(fauxAssistantMessage("late"));
  });
});
