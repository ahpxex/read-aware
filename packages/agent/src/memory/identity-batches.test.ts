import { expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { createInMemoryDeps, seedMemory } from "../testing/fixtures";
import type { CompleteFn } from "../models/complete";
import { identityBytes } from "./identity-input";
import { runIdentityConsolidation } from "./identity-consolidation";
import { identityPlan } from "./identity-plan";
import { MAX_IDENTITY_CALLS } from "./identity-work-run";

const model = { contextWindow: 128_000, maxTokens: 8192 } as Model<Api>;
function fixture() {
  const result = createInMemoryDeps({
    memories: Array.from({ length: 12 }, (_, index) =>
      seedMemory({
        id: `memory-${index}`,
        scope: "user",
        evidenceCount: 3,
        content: `${index}:` + "Substantial evidence. ".repeat(500),
      }),
    ),
  });
  result.deps.log = { warn() {}, error() {} };
  return result;
}
type Data = {
  memories?: { id: string; content: string; fragment: { start: number; end: number; total: number } }[];
  identities?: unknown[];
  digests?: { summary: string; memoryIds: string[] }[];
};
const sourceIds = (data: Data) => [
  ...new Set([
    ...(data.memories?.map((item) => item.id) ?? []),
    ...(data.digests?.flatMap((item) => item.memoryIds) ?? []),
  ]),
];
function answer(data: Data) {
  return fauxAssistantMessage(
    JSON.stringify(
      data.identities
        ? { summary: "Consolidated supported evidence", complete: true, resolutions: [], merges: [] }
        : { summary: "Supported evidence, with uncertainty preserved", memoryIds: sourceIds(data) },
    ),
  );
}
const run = (deps: ReturnType<typeof fixture>["deps"], complete: CompleteFn, signal?: AbortSignal) =>
  runIdentityConsolidation({ deps, complete, model, signal });

test("a final entity decision cannot cite a source dropped by intermediate summaries", async () => {
  const { deps } = fixture(),
    snapshot = await deps.identityConsolidation.snapshot();
  const data = {
    memories: [],
    identities: [],
    digests: [{ summary: "Explicit reader evidence", memoryIds: ["memory-0"] }],
  };
  const proposal = (id: string) =>
    JSON.stringify({
      summary: "Supported",
      complete: true,
      merges: [],
      resolutions: [{ entityId: null, kind: "person", canonicalName: "Alex", aliases: [], memoryIds: [id] }],
    });
  await expect(identityPlan(proposal("memory-1"), snapshot, data)).rejects.toMatchObject({
    code: "memory/invalid-input",
  });
  expect((await identityPlan(proposal("memory-0"), snapshot, data)).decisions[0]!.memoryIds).toEqual(["memory-0"]);
});

test("oversized evidence is reduced in one pass: every fragment visited, only the complete source set published", async () => {
  const { deps, stores } = fixture();
  stores.memories[0]!.content = '\u{1F642}"\n'.repeat(6000);
  const fragments = new Map<string, Data["memories"]>(),
    inputs: string[] = [];
  let finalCalls = 0,
    leafCalls = 0;
  const complete: CompleteFn = async (_model, context) => {
    const json = context.messages[0]!.content as string,
      data = JSON.parse(json) as Data;
    if (data.identities) {
      finalCalls++;
      expect(data.memories).toEqual([]);
      expect(data.digests).toHaveLength(1);
      expect(sourceIds(data).sort()).toEqual(stores.memories.map((item) => item.id).sort());
    } else {
      expect(identityBytes(json)).toBeLessThanOrEqual(8000);
      inputs.push(json);
      if (data.memories) leafCalls++;
      for (const fragment of data.memories ?? []) {
        expect(fragment.content).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
        const list = fragments.get(fragment.id) ?? [];
        list.push(fragment);
        fragments.set(fragment.id, list);
      }
    }
    return answer(data);
  };
  expect(await run(deps, complete)).toMatchObject({ status: "complete" });
  expect(finalCalls).toBe(1);
  expect(inputs).toHaveLength(2 * leafCalls - 1);
  for (const memory of stores.memories) {
    const parts = fragments.get(memory.id)!;
    expect(parts.map((part) => part.content).join("")).toBe(memory.content);
    expect(parts[0]!.fragment.start).toBe(0);
    expect(parts[parts.length - 1]!.fragment.end).toBe(memory.content.length);
    for (let index = 1; index < parts.length; index++)
      expect(parts[index]!.fragment.start).toBe(parts[index - 1]!.fragment.end);
  }
  const snapshot = await deps.identityConsolidation.snapshot();
  expect(snapshot.settled).toBe(true);
  expect((await deps.profile.getProfileContext()).consolidated?.sources).toHaveLength(stores.memories.length);
});

test("incomplete, injected and unsupported intermediate output never reaches a commit", async () => {
  for (const value of [
    "not JSON",
    { summary: "Unsupported", memoryIds: ["unseen"] },
    { summary: "Claim", memoryIds: [] },
    { summary: "", memoryIds: ["memory-0"] },
    { summary: "x".repeat(3501), memoryIds: ["memory-0"] },
    { summary: "Claim", memoryIds: ["memory-0"], complete: true },
  ]) {
    const { deps } = fixture();
    expect(
      await run(deps, async () => fauxAssistantMessage(typeof value === "string" ? value : JSON.stringify(value))),
    ).toMatchObject({ status: "pending" });
    const snapshot = await deps.identityConsolidation.snapshot();
    expect(snapshot.derived).toBeNull();
    expect(snapshot.settled).toBe(false);
  }
});

test("source changes and cancellation after model dispatch do not commit a stale consolidation", async () => {
  for (const cancel of [false, true]) {
    const { deps, stores } = fixture(),
      controller = new AbortController();
    const task = run(
      deps,
      async (_model, context) => {
        if (cancel) controller.abort(new Error("Stopped"));
        else stores.memories[0]!.content = "Concurrent correction";
        return answer(JSON.parse(context.messages[0]!.content as string));
      },
      controller.signal,
    );
    if (cancel) await expect(task).rejects.toThrow("Stopped");
    else expect(await task).toMatchObject({ status: "pending" });
    const snapshot = await deps.identityConsolidation.snapshot();
    expect(snapshot.derived).toBeNull();
  }
});

test("an invalid oversized registry row is not truncated or falsely settled", async () => {
  const { deps } = fixture(),
    query = deps.entityRegistry.query;
  deps.entityRegistry.query = async (input, signal) => {
    const page = await query(input, signal);
    return page.kind === "identities"
      ? { ...page, items: [{ id: "large", definition: { kind: "person", canonicalName: "x".repeat(48000) } }] }
      : page;
  };
  let registryCalls = 0;
  expect(
    await run(deps, async (_model, context) => {
      const data = JSON.parse(context.messages[0]!.content as string);
      if (data.partition || data.identities) registryCalls++;
      return answer(data);
    }),
  ).toMatchObject({ status: "pending" });
  expect(registryCalls).toBe(0);
  expect((await deps.identityConsolidation.snapshot()).settled).toBe(false);
});

test("an input needing more model calls than one pass allows stays pending", async () => {
  const { deps, stores } = fixture();
  for (const memory of stores.memories) memory.content = "Long evidence. ".repeat(40_000);
  let calls = 0;
  expect(
    await run(deps, async (_model, context) => {
      calls++;
      return answer(JSON.parse(context.messages[0]!.content as string));
    }),
  ).toMatchObject({ status: "pending" });
  expect(calls).toBe(MAX_IDENTITY_CALLS);
  expect((await deps.identityConsolidation.snapshot()).derived).toBeNull();
});
