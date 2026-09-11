import { expect, test } from "bun:test";
import { createInMemoryDeps, seedMemory } from "../testing/fixtures";
import { createAgentRuntime } from "./runtime";
import { CUSTOM_OPENAI_PROVIDER_ID } from "../models/custom-openai";
import { memoryPolicyState } from "../testing/memory-policy";

const defer = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

test("actual runtime transport runs identity work independently of ordinary memory checkpoint and survives runtime recreation", async () => {
  const { deps } = createInMemoryDeps({ memories: [seedMemory({ id: "a", scope: "user", content: "Reader prefers history", evidenceCount: 3, updatedAt: new Date().toISOString() })] });
  const policy = memoryPolicyState(); deps.memoryPolicy = policy.policy;
  const requests: Record<string, unknown>[] = [];
  let beforeResponse = async () => {};
  const create = () => createAgentRuntime({ deps, account: { kind: "api-key", provider: CUSTOM_OPENAI_PROVIDER_ID, apiKey: "test", baseUrl: "http://127.0.0.1/identity-fixture/v1", api: "openai-completions" },
    models: { smart: "fixture", fast: "fixture" }, fetch: async (_url, init) => {
      const body = JSON.parse(init?.body as string); requests.push(body);
      await beforeResponse();
      const value = JSON.stringify({ summary: "Reader prefers history", complete: true, resolutions: [], merges: [] });
      const chunk = (delta: object, reason: string | null) => `data: ${JSON.stringify({ id: "completion", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`;
      return new Response(chunk({ content: value }, null) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
    } });
  const runtime = create();
  expect(await runtime.consolidateIfNeeded()).toMatchObject({ identity: { status: "complete" } });
  expect(await runtime.consolidateIfNeeded()).toBeNull();
  expect(requests).toHaveLength(1);
  expect(requests[0]!.max_tokens ?? requests[0]!.max_completion_tokens).toBe(4096);
  expect(await create().consolidateIfNeeded()).not.toBeNull(); // Ordinary in-memory maintenance gate is new.
  expect(requests).toHaveLength(1); // Durable identity state is not.
  await deps.profile.putProfileSummary("New curated summary");
  const entered = defer(), release = defer();
  beforeResponse = async () => { entered.resolve(); await release.promise; };
  const first = runtime.consolidateIfNeeded(), second = runtime.consolidateIfNeeded();
  await entered.promise;
  expect(first).toBe(second);
  expect(requests).toHaveLength(2);
  release.resolve();
  expect(await first).toMatchObject({ identity: { status: "complete" }, decayed: 0, merged: 0 });
  expect(await runtime.consolidateIfNeeded()).toBeNull();
  policy.set(false);
  expect(await runtime.consolidateIfNeeded()).toBeNull();
  await expect(runtime.consolidate()).rejects.toMatchObject({ code: "ai/memory-disabled" });
  expect(requests).toHaveLength(2);
});
