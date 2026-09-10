import { expect, test } from "bun:test";
import { createAssistantMessageEventStream, type Api, type Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import type { CompleteFn, StreamFn } from "../models/complete";
import { contextPolicyState } from "../testing/reading-context-policy";
import { createInMemoryDeps } from "../testing/fixtures";
import { askOneShot, askOneShotDetailed } from "./one-shot";
import { createAgentRuntime } from "./runtime";

const model = { id: "probe", provider: "openai", api: "openai-completions" } as Model<Api>;
const readingContext = { selection: "SELECTION_947", surrounding: "PASSAGE_628" };
function fixture(complete: CompleteFn, stream: StreamFn = () => { throw Error("Unexpected stream"); }) {
  const policy = contextPolicyState({ selection: true, surrounding: true });
  return { policy, deps: { resolveModel: () => model, completeFns: { fast: complete, smart: complete },
    streamFns: { fast: stream, smart: stream }, readingContextPolicy: policy } };
}

test("detailed structured replies retain usage for both attempts and clamp each requested output cap", async () => {
  const caps: Array<number | undefined> = [];
  const messages: ReturnType<typeof fauxAssistantMessage>[] = [];
  const f = fixture(async (_model, _context, options) => {
    caps.push(options?.maxTokens);
    const message = fauxAssistantMessage(caps.length === 1 ? "not JSON" : '{"answer":"ok"}');
    message.usage = { input: 20, output: 10, reasoning: 4, cacheRead: 5, cacheWrite: 0, totalTokens: 35,
      cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0, total: 0.031 } };
    messages.push(message); return message;
  });
  f.deps.resolveModel = () => ({ ...model, maxTokens: 256, cost: { input: 1, output: 2, cacheRead: 1, cacheWrite: 1 } });
  const result = await askOneShotDetailed({ prompt: "p", maxOutputTokens: 512, schema: { type: "object", required: ["answer"] } }, f.deps);
  expect(result.value).toEqual({ answer: "ok" }); expect(caps).toEqual([256, 256]);
  expect(result.attempts).toHaveLength(2);
  expect(result.attempts[0]).toEqual({ model: { id: "probe", provider: "openai" }, stopReason: "stop", maxOutputTokens: 256,
    usage: { input: 20, output: 10, reasoning: 4, cacheRead: 5, cacheWrite: 0, totalTokens: 35 }, estimatedCostUsd: 0.031 });
  messages[0].usage.input = 999;
  expect(result.attempts[0].usage?.input).toBe(20);
  expect(JSON.stringify(result)).not.toContain("not JSON");
});

test("detailed streaming exposes length termination, unknown usage/pricing and no provider internals", async () => {
  const source = createAssistantMessageEventStream();
  let cap: number | undefined;
  const f = fixture(async () => { throw Error("Unexpected completion"); }, (_model, _context, options) => { cap = options?.maxTokens; return source; });
  const deltas: string[] = [];
  const pending = askOneShotDetailed({ prompt: "p", maxOutputTokens: 32, onText: text => { deltas.push(text); } }, f.deps);
  const message = fauxAssistantMessage("short"); message.stopReason = "length";
  message.responseId = "PRIVATE_RESPONSE_ID";
  source.push({ type: "text_delta", contentIndex: 0, delta: "short", partial: message });
  source.push({ type: "done", reason: "length", message });
  const result = await pending;
  expect(cap).toBe(32); expect(deltas).toEqual(["short"]); expect(result.value).toBe("short");
  expect(result.attempts[0]).toMatchObject({ stopReason: "length", usage: null, estimatedCostUsd: null });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_RESPONSE_ID");
});

test("detailed inference rejects invalid caps, does not invent missing cost, and retains cancellation", async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    const message = fauxAssistantMessage("ok");
    message.usage.input = 20; message.usage.output = NaN;
    message.usage.cost.total = 100;
    return message;
  });
  for (const maxOutputTokens of [0, -1, 1.5, Infinity]) {
    await expect(askOneShotDetailed({ prompt: "p", maxOutputTokens }, f.deps)).rejects.toThrow("positive safe integer");
  }
  expect(calls).toBe(0);
  const result = await askOneShotDetailed({ prompt: "p" }, f.deps);
  expect(result.attempts[0]).toMatchObject({ maxOutputTokens: null, usage: { input: 20, output: null }, estimatedCostUsd: null });
  const controller = new AbortController();
  const pending = askOneShotDetailed({ prompt: "p", signal: controller.signal }, f.deps);
  controller.abort(new Error("stopped"));
  await expect(pending).rejects.toThrow("stopped");
});

test("caller cancellation covers plain inference and suppresses structured retries", async () => {
  for (const schema of [undefined, { type: "object" }]) {
    let finish!: (message: ReturnType<typeof fauxAssistantMessage>) => void;
    let signal: AbortSignal | undefined;
    let calls = 0;
    const f = fixture((_model, _context, options) => {
      calls++; signal = options?.signal;
      return new Promise(resolve => { finish = resolve; });
    });
    const controller = new AbortController();
    const pending = askOneShot({ prompt: "plain", schema, signal: controller.signal }, f.deps);
    const reason = new Error("caller stopped"); controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(signal?.aborted).toBe(true);
    finish(fauxAssistantMessage("invalid"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(calls).toBe(1);
    await expect(askOneShot({ prompt: "pre-aborted", signal: controller.signal }, f.deps)).rejects.toBe(reason);
    expect(calls).toBe(1);
  }
});

test("stream callback acknowledgement supplies backpressure and cancellation drops queued deltas", async () => {
  const source = createAssistantMessageEventStream();
  const f = fixture(async () => { throw Error("Unexpected completion"); }, () => source);
  const controller = new AbortController();
  const received: string[] = [];
  let acknowledge!: () => void;
  const pending = askOneShot({ prompt: "plain", signal: controller.signal, onText: async delta => {
    received.push(delta); await new Promise<void>(resolve => { acknowledge = resolve; });
  } }, f.deps);
  for (const delta of ["first", "second"]) source.push({ type: "text_delta", contentIndex: 0, delta, partial: fauxAssistantMessage(delta) });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(received).toEqual(["first"]);
  controller.abort(new Error("stopped"));
  await expect(pending).rejects.toThrow("stopped");
  acknowledge();
  source.push({ type: "done", reason: "stop", message: fauxAssistantMessage("late") });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(received).toEqual(["first"]);
});

test("a failed stream consumer aborts the provider before releasing its policy subscription", async () => {
  const source = createAssistantMessageEventStream();
  let signal: AbortSignal | undefined;
  const f = fixture(async () => { throw Error("Unexpected completion"); }, (_model, _context, options) => {
    signal = options?.signal; return source;
  });
  const pending = askOneShot({ prompt: "plain", onText: async () => { throw new Error("consumer failed"); } }, f.deps);
  source.push({ type: "text_delta", contentIndex: 0, delta: "first", partial: fauxAssistantMessage("first") });
  await expect(pending).rejects.toThrow("consumer failed");
  expect(signal?.aborted).toBe(true);
  source.push({ type: "done", reason: "stop", message: fauxAssistantMessage("late") });
});

test("plain and structured retries use the same filtered context, without mutating input", async () => {
  const prompts: string[] = [];
  const f = fixture(async (_model, context) => {
    prompts.push(JSON.stringify(context));
    return fauxAssistantMessage(prompts.length === 1 ? "invalid" : '{"answer":"ok"}');
  });
  f.policy.set({ selection: true, surrounding: false });
  expect(await askOneShot({ prompt: "typed", readingContext, schema: { type: "object", required: ["answer"] } }, f.deps))
    .toEqual({ answer: "ok" });
  expect(prompts).toHaveLength(2);
  for (const prompt of prompts) { expect(prompt).toContain("SELECTION_947"); expect(prompt).not.toContain("PASSAGE_628"); }
  expect(readingContext.surrounding).toBe("PASSAGE_628");
  expect(f.policy.listeners()).toBe(0);
});

test("withheld or malformed context fails before model resolution or provider access", async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return fauxAssistantMessage("unexpected"); });
  f.policy.set({ selection: false, surrounding: false });
  await expect(askOneShot({ prompt: "typed", readingContext: { ...readingContext, required: ["selection"] } }, f.deps))
    .rejects.toMatchObject({ code: "ai/context-withheld" });
  await expect(askOneShot({ prompt: "typed", readingContext: { selection: 2 } as never }, f.deps))
    .rejects.toMatchObject({ code: "ai/invalid-reading-context" });
  expect(calls).toBe(0); expect(f.policy.listeners()).toBe(0);
});

test("revocation rejects a hung completion promptly and cannot become a retry after off/on", async () => {
  let resolve!: (value: ReturnType<typeof fauxAssistantMessage>) => void;
  let signal: AbortSignal | undefined;
  let calls = 0;
  const f = fixture((_model, _context, options) => {
    signal = options?.signal; calls++;
    return new Promise(done => { resolve = done; });
  });
  const result = askOneShot({ prompt: "typed", readingContext, schema: { type: "object" } }, f.deps);
  f.policy.set({ selection: false, surrounding: true });
  f.policy.set({ selection: true, surrounding: true });
  await expect(result).rejects.toMatchObject({ code: "ai/context-changed" });
  expect(signal?.aborted).toBe(true);
  resolve(fauxAssistantMessage("invalid, would normally retry"));
  await new Promise(done => setTimeout(done, 0));
  expect(calls).toBe(1); expect(f.policy.listeners()).toBe(0);
});

test("settled provider results still lose to same-turn policy revocation", async () => {
  const f = fixture(async () => fauxAssistantMessage("already settled"));
  const result = askOneShot({ prompt: "typed", readingContext }, f.deps);
  f.policy.set({ selection: true, surrounding: false });
  await expect(result).rejects.toMatchObject({ code: "ai/context-changed" });
  expect(f.policy.listeners()).toBe(0);
});

test("revoked stream aborts without waiting and drops late deltas", async () => {
  const source = createAssistantMessageEventStream();
  let signal: AbortSignal | undefined;
  const f = fixture(async () => { throw Error("Unexpected complete"); }, (_model, _context, options) => {
    signal = options?.signal; return source;
  });
  const deltas: string[] = [];
  const result = askOneShot({ prompt: "typed", readingContext, onText: text => deltas.push(text) }, f.deps);
  source.push({ type: "text_delta", contentIndex: 0, delta: "first", partial: fauxAssistantMessage("first") });
  await new Promise(done => setTimeout(done, 0));
  expect(deltas).toEqual(["first"]);
  f.policy.set({ selection: false, surrounding: false });
  await expect(result).rejects.toMatchObject({ code: "ai/context-changed" });
  f.policy.set({ selection: true, surrounding: true });
  source.push({ type: "text_delta", contentIndex: 0, delta: "late", partial: fauxAssistantMessage("late") });
  source.push({ type: "done", reason: "stop", message: fauxAssistantMessage("late") });
  await new Promise(done => setTimeout(done, 0));
  expect(deltas).toEqual(["first"]); expect(signal?.aborted).toBe(true); expect(f.policy.listeners()).toBe(0);
});

test("ordinary typed prompts are not misclassified as book text", async () => {
  const f = fixture(async (_model, context) => fauxAssistantMessage(JSON.stringify(context)));
  f.policy.set({ selection: false, surrounding: false });
  expect(await askOneShot({ prompt: "typed SELECTION_947" }, f.deps)).toContain("typed SELECTION_947");
  expect(f.policy.listeners()).toBe(0);
});

test("AgentRuntime forwards its host policy to one-shot calls", async () => {
  const { deps } = createInMemoryDeps();
  deps.readingContextPolicy = contextPolicyState({ selection: false, surrounding: false });
  const runtime = createAgentRuntime({ deps, account: { kind: "api-key", provider: "openai", apiKey: "never-used" },
    models: { fast: "not-resolved", smart: "not-resolved" } });
  await expect(runtime.ask({ prompt: "typed", readingContext: { selection: "private", required: ["selection"] } }))
    .rejects.toMatchObject({ code: "ai/context-withheld" });
  await expect(runtime.askDetailed({ prompt: "typed", readingContext: { selection: "private", required: ["selection"] } }))
    .rejects.toMatchObject({ code: "ai/context-withheld" });
});
